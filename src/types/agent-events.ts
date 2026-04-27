export type AgentEvent =
  | { type: 'token'; content: string }
  | { type: 'plan'; items: AgentPlanItem[] }
  | { type: 'tool'; id: string; tool: string; path: string; detail: string; status: 'running' | 'done' | 'error' }
  | { type: 'diff'; patch: string }
  | { type: 'permission'; id: string; tool: string; path: string; detail: string; risk: 'low' | 'high' }
  | { type: 'done' }
  | { type: 'error'; message: string }

export interface AgentPlanItem {
  id: string
  label: string
  status: 'pending' | 'active' | 'done'
}
