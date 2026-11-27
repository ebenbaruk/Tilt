// The parts of DeepSeek Harness (Cordis plugin context) this plugin uses. dsh is a developer
// preview whose packages are not installed here; these mirror deepseek-ai/deepseek-harness
// packages/core/agent/src/runtime-types.ts (`agent/status`), packages/interaction/commands
// (`ctx.commands`).

/** An agent is only compared by identity here; nothing on it is read. */
export type Agent = object;

export type CommandResult = { kind: "success"; text?: string } | { kind: "error"; text: string };

export interface CommandDefinition {
  name: string;
  description: string;
  input?: { hint: string };
  handler: (invocation: { rawInput: string }) => CommandResult | Promise<CommandResult>;
}

export interface DshContext {
  on(event: "agent/status", listener: (payload: { agent: Agent; status: string }) => void): () => void;
  on(event: "agent/disposed", listener: (payload: { agent: Agent }) => void): () => void;
  /** Runs `setup` now and its returned disposer when the plugin unloads. */
  effect(setup: () => () => void): void;
  readonly commands: { register(definition: CommandDefinition): () => void };
}
