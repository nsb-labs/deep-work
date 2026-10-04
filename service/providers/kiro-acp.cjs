const fs = require('node:fs');
const path = require('node:path');
const { runProcess } = require('./process.cjs');
const { prepareLaunch, wslPath } = require('./cli.cjs');

function writeAgent(directory, settings) {
  if (settings.agent) return;
  const agents = path.join(directory, '.kiro', 'agents');
  fs.mkdirSync(agents, { recursive: true });
  fs.writeFileSync(
    path.join(agents, 'deepwork.json'),
    JSON.stringify({
      name: 'deepwork',
      description: 'DeepWork context processing without tools',
      tools: [],
      allowedTools: [],
      resources: [],
      mcpServers: {},
      includeMcpJson: false,
      includePowers: false,
      hooks: {},
    }),
  );
}

// ACP keeps permission requests attached to the live inference session. Never parse terminal prompts.
function acpProtocol(
  prompt,
  cwd,
  {
    signal,
    emit = () => {},
    onConsole = () => {},
    requestPermission,
    structured = false,
    agent = 'deepwork',
  } = {},
) {
  let send,
    close,
    pause = () => {},
    sessionId,
    answer = '',
    finalAnswer = '',
    messageId,
    completed = false,
    failure;
  const pending = new Set();
  const tools = new Map();
  const rememberTool = (update) => {
    if (typeof update?.toolCallId !== 'string') throw new Error('Kiro tool call has no ID');
    const previous = tools.get(update.toolCallId) || {};
    const tool = {
      ...previous,
      ...Object.fromEntries(Object.entries(update).filter(([, value]) => value != null)),
    };
    if (Buffer.byteLength(JSON.stringify(tool)) > 16000)
      throw new Error('Kiro tool details exceeded limit');
    if (!tools.has(update.toolCallId) && tools.size >= 100) tools.delete(tools.keys().next().value);
    tools.set(update.toolCallId, tool);
    return tool;
  };
  return {
    start(write, end, setPaused) {
      send = (value) => write(JSON.stringify({ jsonrpc: '2.0', ...value }) + '\n');
      close = end;
      pause = setPaused || pause;
      send({
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: 1,
          clientCapabilities: {},
          clientInfo: { name: 'deepwork', version: '2.0.0' },
        },
      });
    },
    event(event) {
      if (event.error)
        throw new Error(
          'Kiro ACP request failed. Check authentication, agent configuration and ACP support.',
        );
      if (event.method && Object.hasOwn(event, 'id')) {
        if (event.method !== 'session/request_permission') {
          send({
            id: event.id,
            error: {
              code: -32601,
              message: 'DeepWork does not provide filesystem or terminal tools.',
            },
          });
          return;
        }
        const params = event.params;
        if (!sessionId || params?.sessionId !== sessionId || pending.has(event.id))
          throw new Error('Invalid Kiro permission request');
        const toolCall = rememberTool(params.toolCall);
        const consent = params._meta?.kiro?.consent;
        if (consent) toolCall.consent = consent;
        const hasDetails = typeof toolCall.title === 'string' && toolCall.title.trim();
        const options = params.options?.filter(
          (o) =>
            ['allow_once', 'reject_once'].includes(o.kind) &&
            (o.kind !== 'allow_once' || hasDetails) &&
            typeof o.optionId === 'string' &&
            typeof o.name === 'string',
        );
        if (!Array.isArray(options) || !options.length || options.length > 20)
          throw new Error('Kiro supplied no supported one-time permission choices');
        finalAnswer = '';
        pending.add(event.id);
        pause(true);
        Promise.resolve()
          .then(() =>
            requestPermission?.(
              {
                providerRequestId: event.id,
                sessionId,
                toolCall,
                options,
              },
              signal,
            ),
          )
          .then((optionId) => {
            if (optionId != null && !options.some((o) => o.optionId === optionId))
              throw new Error('Invalid permission decision');
            send({
              id: event.id,
              result: {
                outcome:
                  optionId == null ? { outcome: 'cancelled' } : { outcome: 'selected', optionId },
              },
            });
          })
          .catch(() => {
            failure = new Error('Kiro permission request could not be resolved');
            send({ id: event.id, result: { outcome: { outcome: 'cancelled' } } });
            close();
          })
          .finally(() => {
            pending.delete(event.id);
            pause(pending.size > 0);
          });
        return;
      }
      if (event.id === 1) {
        if (event.result?.protocolVersion !== 1) throw new Error('Unsupported Kiro ACP version');
        send({
          id: 2,
          method: 'session/new',
          params: { cwd, mcpServers: [], _meta: { kiro: { modeId: agent } } },
        });
      } else if (event.id === 2) {
        sessionId = event.result?.sessionId;
        if (typeof sessionId !== 'string') throw new Error('Kiro returned no ACP session');
        if (event.result?.modes?.currentModeId !== agent)
          throw new Error(
            'Kiro did not select the configured agent mode. Check agent availability in this workspace.',
          );
        onConsole('Kiro session connected.');
        send({
          id: 3,
          method: 'session/prompt',
          params: { sessionId, prompt: [{ type: 'text', text: prompt }] },
        });
      } else if (event.id === 3) {
        if (event.result?.stopReason !== 'end_turn' || pending.size)
          throw new Error('Kiro turn stopped before completion');
        completed = true;
        close();
      }
      if (['session/update', 'session/notification'].includes(event.method)) {
        if (event.params?.sessionId !== sessionId)
          throw new Error('Mismatched Kiro session update');
        const update = event.params.update;
        if (update?.sessionUpdate === 'agent_message_chunk' && update.content?.type === 'text') {
          if (typeof update.messageId === 'string' && update.messageId !== messageId) {
            finalAnswer = '';
            messageId = update.messageId;
          }
          answer += update.content.text;
          finalAnswer += update.content.text;
          if (Buffer.byteLength(answer) > 4 * 1024 * 1024)
            throw new Error('Kiro response exceeded limit');
          emit(answer);
        }
        if (['tool_call', 'tool_call_update'].includes(update?.sessionUpdate)) {
          if (update.sessionUpdate === 'tool_call') finalAnswer = '';
          const tool = rememberTool(update);
          onConsole(`${tool.title || tool.toolCallId}: ${tool.status || 'pending'}`);
        }
      }
    },
    finish() {
      if (failure) throw failure;
      const result = structured ? finalAnswer : answer;
      if (!completed || !result.trim())
        throw new Error(
          'Kiro stopped without a complete answer. Check authentication and ACP support.',
        );
      return result;
    },
  };
}
async function runKiro(prompt, directory, settings, signal, options = {}) {
  writeAgent(directory, settings);
  const args = ['acp', '--agent-engine=v3', '--auth-method=cli'];
  const { launch, onStop } = prepareLaunch(settings, args, directory);
  const protocol = acpProtocol(
    prompt,
    settings.execution === 'wsl' ? wslPath(directory) : directory,
    {
      ...options,
      agent: settings.agent || 'deepwork',
      signal,
      emit: (answer) => {
        options.onOutput?.(answer);
        options.emit?.(answer);
      },
    },
  );
  const { jsonLines } = require('./chat.cjs');
  const lines = jsonLines((event) => protocol.event(event));
  await (options.run || runProcess)(launch.command, launch.args, {
    cwd: directory,
    signal,
    onStop,
    timeout: settings.timeoutSeconds * 1000,
    onStart: protocol.start,
    onStdout: (chunk) => lines.push(chunk),
    env: { ...process.env, NO_COLOR: '1', KIRO_NO_PROGRESS: '1', KIRO_NO_HYPERLINKS: '1' },
  });
  lines.end();
  return protocol.finish();
}
module.exports = { acpProtocol, runKiro };
