export interface PermissionRequest {
  id: string
  tool: string
  path: string
  detail: string
  risk: 'low' | 'high'
}
