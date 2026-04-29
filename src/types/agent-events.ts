/**
 * Tag identifying which workbench session emitted this event. Tauri's
 * `app.emit` is a global broadcast — every renderer-side listener receives
 * every emit. Listeners must filter by `task_id === their captured session
 * id` so concurrent sessions don't bleed into each other.
 */
type TaggedEvent<T> = T & { task_id: string };

export type AgentEvent = TaggedEvent<
  | { type: 'token'; content: string }
  | { type: 'plan'; items: AgentPlanItem[] }
  | { type: 'tool'; id: string; tool: string; path: string; detail: string; status: 'running' | 'done' | 'error' }
  | { type: 'diff'; patch: string }
  | { type: 'session'; id: string }
  | { type: 'permission'; id: string; tool: string; path: string; detail: string; risk: 'low' | 'high' }
  | { type: 'done' }
  | { type: 'error'; message: string }
  | { type: 'thinking'; content: string; done: boolean; duration_ms: number }
  | { type: 'stopped' }
  | { type: 'usage'; input: number; output: number; cache_read: number; cache_creation: number }
>;

export interface AgentPlanItem {
  id: string
  label: string
  status: 'pending' | 'active' | 'done'
}
