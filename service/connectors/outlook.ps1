# Classic Outlook only. Runs in a separate signed-in-user STA process.
# No credential collection, Graph requests, mailbox deletes, or Send() calls.
param([Parameter(Mandatory=$true)][string]$RequestPath, [Parameter(Mandatory=$true)][string]$ResponsePath)
$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)
$comObjects = New-Object 'System.Collections.Generic.List[object]'
function Keep-Com($obj) { if ($null -ne $obj) { $comObjects.Add($obj) }; return ,$obj }
function Release-Com($obj) { if ($null -ne $obj -and [Runtime.InteropServices.Marshal]::IsComObject($obj)) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($obj) } }
function Resolve-Folder($namespace, [string]$folderPath) {
  $parts = $folderPath.Trim('\').Split('\')
  $folder = Keep-Com ($namespace.Folders.Item($parts[0]))
  for ($i = 1; $i -lt $parts.Length; $i++) { $folder = Keep-Com ($folder.Folders.Item($parts[$i])) }
  return $folder
}
function Sender-Address($item) {
  if ($item.SenderEmailType -eq 'EX') {
    $sender = $null; $exchangeUser = $null
    try { $sender = $item.Sender; $exchangeUser = $sender.GetExchangeUser(); if ($exchangeUser -and $exchangeUser.PrimarySmtpAddress) { return [string]$exchangeUser.PrimarySmtpAddress } }
    finally { Release-Com $exchangeUser; Release-Com $sender }
  }
  return [string]$item.SenderEmailAddress
}
try {
  $request = Get-Content -LiteralPath $RequestPath -Raw -Encoding UTF8 | ConvertFrom-Json
  $outlook = Keep-Com (New-Object -ComObject Outlook.Application)
  $namespace = Keep-Com ($outlook.GetNamespace('MAPI'))
  if ($request.operation -eq 'open') {
    $item = Keep-Com ($namespace.GetItemFromID([string]$request.providerId, [string]$request.storeId))
    $item.Display()
    $result = @{ ok=$true }
  } elseif ($request.operation -eq 'folders') {
    # Shallow enumeration plus default Inbox / Sent Items. Users can configure nested folder paths.
    $folders = @()
    foreach ($code in @(6,5)) { $folder = Keep-Com ($namespace.GetDefaultFolder($code)); $folders += [string]$folder.FolderPath }
    $result = @{ ok=$true; folders=$folders; profile=[string]$namespace.CurrentProfileName }
  } elseif ($request.operation -eq 'sync') {
    $days = [int]$request.lookbackDays
    $max = [int]$request.maxMessages
    if ($days -lt 1 -or $days -gt 15 -or $max -lt 1 -or $max -gt 5000) { throw 'Invalid sync limits' }
    $since = (Get-Date).AddDays(-$days)
    $messages = New-Object 'System.Collections.Generic.List[object]'
    $warnings = New-Object 'System.Collections.Generic.List[string]'
    $folderPaths = @($request.folders)
    if ($folderPaths.Count -eq 0) {
      foreach ($code in @(6,5)) { $folder = Keep-Com ($namespace.GetDefaultFolder($code)); $folderPaths += [string]$folder.FolderPath }
    }
    $tracked = @($request.trackedThreads)
    $groups = New-Object 'System.Collections.Generic.List[object]'
    $nextOffsets = @{}
    foreach ($folderPath in $folderPaths) {
      $folder = Resolve-Folder $namespace ([string]$folderPath)
      $store = Keep-Com ($folder.Store)
      $sentFolder = Keep-Com ($store.GetDefaultFolder(5))
      $isSentFolder = ([string]$folder.EntryID -eq [string]$sentFolder.EntryID)
      $items = Keep-Com ($folder.Items)
      # Restrict by recent received/sent/modified timestamps; tracked conversations are queried separately.
      $date = $since.ToString('g', [Globalization.CultureInfo]::CurrentCulture)
      $recent = Keep-Com ($items.Restrict("[ReceivedTime] >= '$date' OR [SentOn] >= '$date' OR [LastModificationTime] >= '$date'"))
      if ($isSentFolder) { $recent.Sort('[SentOn]', $true) } else { $recent.Sort('[ReceivedTime]', $true) }
      $groups.Add(@{ key=([string]$folderPath + '::recent'); items=$recent; folder=$folder; sent=$isSentFolder })
      foreach ($thread in $tracked) {
        if ($thread.account -eq [string]$folder.StoreID -and $thread.threadId -match '^[A-Fa-f0-9]+$') {
          try {
            $set = Keep-Com ($items.Restrict("[ConversationID] = '$($thread.threadId)'"))
            if ($isSentFolder) { $set.Sort('[SentOn]', $true) } else { $set.Sort('[ReceivedTime]', $true) }
            $groups.Add(@{ key=([string]$folderPath + '::' + $thread.threadId); items=$set; folder=$folder; sent=$isSentFolder })
          } catch { $warnings.Add('An older tracked conversation could not be queried in a configured folder.') }
        }
      }
    }
    # Rotate groups, so a small global limit cannot permanently starve a folder or tracked conversation.
    $groupCount = $groups.Count
    $startGroup = 0
    if ($request.cursor -and $groupCount -gt 0) { $startGroup = [Math]::Abs([int]$request.cursor.nextGroup) % $groupCount }
    $groupsThisRun = [Math]::Min($groupCount, $max)
    $quota = if ($groupsThisRun -gt 0) { [Math]::Max(1, [Math]::Floor($max / $groupsThisRun)) } else { 0 }
    $seen = New-Object 'System.Collections.Generic.HashSet[string]'
    for ($g=0; $g -lt $groupCount; $g++) {
      $group = $groups[($startGroup + $g) % $groupCount]
      $set = $group.items
      $folder = $group.folder
      $offset = 0
      if ($request.cursor -and $request.cursor.offsets) {
        $property = $request.cursor.offsets.PSObject.Properties[[string]$group.key]
        if ($property) { $offset = [Math]::Max(0, [int]$property.Value) }
      }
      if ($offset -ge $set.Count) { $offset = 0 }
      $nextOffsets[$group.key] = $offset
      if ($g -ge $groupsThisRun) { continue }
      $end = [Math]::Min($set.Count, $offset + $quota)
      for ($i=$offset+1; $i -le $end; $i++) {
        $item = $null; $accessor = $null
        try {
          $item = $set.Item($i)
          $dedup = [string]$folder.StoreID + ':' + [string]$item.EntryID
          if ($item.Class -ne 43 -or -not $seen.Add($dedup)) { continue }
          $accessor = $item.PropertyAccessor
          $internetId = ''
          try { $internetId = [string]$accessor.GetProperty('http://schemas.microsoft.com/mapi/proptag/0x1035001F') } catch {}
          $sender = Sender-Address $item
          if (-not $sender) { $sender = [string]$item.SenderName }
          if (-not $sender) { $sender = 'Unknown sender' }
          $body = [string]$item.Body
          if ($body.Length -gt 100000) { $body = $body.Substring(0,100000); $warnings.Add('A message body was truncated to 100,000 characters.') }
          $recipients = New-Object 'System.Collections.Generic.List[string]'
          $recipientItems = $null
          try {
            $recipientItems = $item.Recipients
            $recipientCount = [Math]::Min(500, $recipientItems.Count)
            if ($recipientItems.Count -gt 500) { $warnings.Add('A recipient list was truncated to 500 entries.') }
            for ($r=1; $r -le $recipientCount; $r++) {
              $recipient=$null; $entry=$null; $exchange=$null
              try {
                $recipient=$recipientItems.Item($r); $entry=$recipient.AddressEntry
                $address=[string]$recipient.Address
                if ($entry.Type -eq 'EX') {
                  $exchange=$entry.GetExchangeUser()
                  if ($exchange -and $exchange.PrimarySmtpAddress) { $address=[string]$exchange.PrimarySmtpAddress }
                }
                if ($address -and $address.Length -le 1000) { $recipients.Add($address) }
              } finally { Release-Com $exchange; Release-Com $entry; Release-Com $recipient }
            }
          } finally { Release-Com $recipientItems }
          $conversation = [string]$item.ConversationID
          if (-not $conversation) { $conversation=[string]$item.EntryID }
          $messages.Add(@{
            account=[string]$folder.StoreID; storeId=[string]$folder.StoreID; providerId=[string]$item.EntryID;
            internetId=$internetId; threadId=$conversation; folder=[string]$folder.FolderPath;
            subject=[string]$item.Subject; sender=$sender; recipients=@($recipients.ToArray());
            body=$body; receivedAt=$item.ReceivedTime.ToUniversalTime().ToString('o');
            sentAt=$item.SentOn.ToUniversalTime().ToString('o');
            modifiedAt=$item.LastModificationTime.ToUniversalTime().ToString('o'); isSent=$group.sent
          })
        } catch { $warnings.Add('A message could not be read. Check cached content and Outlook security policy.') }
        finally { Release-Com $accessor; Release-Com $item }
      }
      # Stable mailbox pages advance across runs. Overlap catches shifts; wraparound rescans new changes.
      $nextOffsets[$group.key] = if ($end -ge $set.Count) { 0 } else { [Math]::Max($offset+1, $end-[Math]::Min(5,[Math]::Floor($quota/4))) }
      if ($end -lt $set.Count) { $warnings.Add('Scan page incomplete. Sync again to continue; cursors advance across folders and tracked conversations.') }
    }
    if ($groupsThisRun -lt $groupCount) { $warnings.Add('Some folders or tracked conversations are deferred to the next sync page.') }
    $nextGroup=0
    if ($groupCount -gt 0) { $nextGroup=($startGroup+$groupsThisRun) % $groupCount }
    $cursor = @{ offsets=$nextOffsets; nextGroup=$nextGroup }
    $result = @{ ok=$true; messages=@($messages.ToArray()); folders=$folderPaths; warnings=@($warnings.ToArray() | Select-Object -Unique); scannedAt=(Get-Date).ToUniversalTime().ToString('o'); cursor=$cursor }
  } else { throw 'Unsupported Outlook operation' }
} catch {
  $result = @{ ok=$false; error='Classic Outlook could not complete the request. Check its installation, signed-in profile, cached folders, and organization policy.' }
} finally {
  for ($i=$comObjects.Count-1; $i -ge 0; $i--) { Release-Com $comObjects[$i] }
  [GC]::Collect(); [GC]::WaitForPendingFinalizers()
}
[IO.File]::WriteAllText($ResponsePath, ($result | ConvertTo-Json -Depth 12 -Compress), $utf8)
