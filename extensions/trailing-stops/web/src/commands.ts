import type { Invoke } from "../../../../src/tools";

/** The Tauri commands of `src-tauri/mod.rs` in this extension, with their arguments (`undefined` when none) and results. */
type TrailingCommandMap = {
  list_trailing_stops: { args: undefined; result: unknown };
  check_trailing_stops_now: { args: undefined; result: unknown };
  add_trailing_stop: { args: { request: object }; result: unknown };
  update_trailing_stop: { args: { request: object }; result: unknown };
  remove_trailing_stop: { args: { id: string }; result: unknown };
  set_trailing_interval: { args: { seconds: number }; result: void };
};

type Command = keyof TrailingCommandMap;
type ArgsOf<K extends Command> = TrailingCommandMap[K]["args"];
type CommandArgs<K extends Command> = ArgsOf<K> extends undefined ? [] : [args: ArgsOf<K>];

export function invokeCommand<K extends Command>(invoke: Invoke, name: K, ...args: CommandArgs<K>): Promise<TrailingCommandMap[K]["result"]> {
  return invoke<TrailingCommandMap[K]["result"]>(name, args[0] as Record<string, unknown> | undefined);
}
