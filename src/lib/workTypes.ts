export type TaskStatus = 'open' | 'in_progress' | 'waiting_on' | 'done' | 'dismissed';
export interface Preferences {
  theme: 'dark' | 'light';
  mode: 'demo' | 'outlook';
  lookbackDays: number;
  vipEmails: string[];
  managerEmails: string[];
  goals: string[];
  folders: string[];
  provider: 'demo' | 'kiro' | 'codex';
  executable: string;
  execution: 'native' | 'wsl';
  wslDistribution: string;
  agent: string;
  organizationApproved: boolean;
  timeoutSeconds: number;
  maxMessages: number;
  retentionDays: number;
  contextTokenBudget: number;
}
export interface Task {
  id: string;
  title: string;
  notes: string;
  owner: string;
  waitingOn: string;
  goal: string;
  dueDate: string;
  status: TaskStatus;
  evidenceIds: string[];
  provenance: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  history: { at: string; status: TaskStatus; reason: string }[];
}
export interface Message {
  id: string;
  version: string;
  processedVersion: string;
  priorityReasons: string[];
  account: string;
  providerId: string;
  storeId: string;
  internetId: string;
  threadId: string;
  folder: string;
  subject: string;
  sender: string;
  recipients: string[];
  receivedAt: string;
  modifiedAt: string;
  body?: string;
  isSent: boolean;
  sentAt?: string;
}
export interface Artifact {
  id: string;
  taskId: string;
  taskRevision: number;
  operation: string;
  text: string;
  provider: string;
  createdAt: string;
  memoryIds: string[];
  evidenceIds: string[];
  userContext: string;
}
export interface Fact {
  id: string;
  subject: string;
  relation: string;
  object: string;
  evidenceId: string;
  quote: string;
  confidence: number;
  provenance: string;
  active: boolean;
  sourceDate: string;
}
export interface Job {
  provider: Preferences['provider'];
  retriedBy?: string;
  attentionDismissed?: boolean;
  contextStats?: {
    estimatedTokens: number;
    budget: number;
    messageCount: number;
    pendingMessageCount: number;
    removedCharacters: number;
  };
  id: string;
  operation: string;
  status: string;
  error: string;
  createdAt: string;
  finishedAt?: string;
  resultId: string;
}
export interface Change {
  taskId: string;
  title: string;
  status: TaskStatus;
  owner: string;
  waitingOn: string;
  dueDate: string;
  goal: string;
  reason: string;
  evidenceIds: string[];
  confidence: number;
}
export interface Suggestion {
  id: string;
  change: Change;
  createdAt: string;
}
export interface CliSession {
  provider: Preferences['provider'];
  jobId: string;
  transcript: string;
  answer: string;
  requests: {
    requestId: string;
    title: string;
    details: string;
    expiresAt: string;
    options: { optionId: string; name: string; kind: 'allow_once' | 'reject_once' }[];
  }[];
}
export interface Snapshot {
  sessions: CliSession[];
  workspace: string;
  platform: string;
  settings: Preferences;
  tasks: Task[];
  messages: Message[];
  facts: Fact[];
  jobs: Job[];
  suggestions: Suggestion[];
  sync: {
    at: string;
    count: number;
    changed: number;
    warnings: string[];
    folders: string[];
  } | null;
  exportError: string;
}
export interface ChatMessage {
  id: string;
  taskId: string;
  jobId: string;
  role: 'user' | 'assistant';
  text: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  createdAt: string;
  provider: string;
  error?: string;
}
export interface ChatEvent {
  taskId: string;
  jobId: string;
  text: string;
  status: ChatMessage['status'];
  error?: string;
}
export interface TaskDetail {
  conversation: ChatMessage[];
  memory: Fact[];
  task: Task;
  messages: Message[];
  artifacts: Artifact[];
}

export interface CliDiscovery {
  installations: {
    provider: 'kiro' | 'codex';
    executable: string;
    execution: 'native' | 'wsl';
    wslDistribution: string;
    version: string;
  }[];
  diagnostics: string[];
  note: string;
}
