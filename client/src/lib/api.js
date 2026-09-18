export class ApiError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

async function request(method, url, body, { raw = false, signal } = {}) {
  const headers = { 'x-obi': '1' }
  let payload
  if (body !== undefined) {
    if (raw) payload = body
    else {
      headers['content-type'] = 'application/json'
      payload = JSON.stringify(body)
    }
  }
  let res
  try {
    res = await fetch(url, { method, headers, body: payload, credentials: 'same-origin', signal })
  } catch (e) {
    if (e.name === 'AbortError') throw e
    throw new ApiError(0, 'Network error — check your connection')
  }
  const text = await res.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  if (!res.ok) {
    if (res.status === 401 && !url.startsWith('/api/auth/')) window.dispatchEvent(new CustomEvent('obi:unauthorized'))
    throw new ApiError(res.status, (data && data.error) || res.statusText || 'Request failed')
  }
  return data
}

const q = (params) => {
  const s = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') s.set(k, v)
  const str = s.toString()
  return str ? `?${str}` : ''
}

const W = (id) => `/api/workspaces/${encodeURIComponent(id)}`

export const api = {
  get: (url, opts) => request('GET', url, undefined, opts),
  post: (url, body) => request('POST', url, body ?? {}),
  patch: (url, body) => request('PATCH', url, body),
  put: (url, body) => request('PUT', url, body),
  del: (url) => request('DELETE', url),

  // auth
  me: () => request('GET', '/api/auth/me'),
  setupStatus: () => request('GET', '/api/auth/setup'),
  setup: (body) => request('POST', '/api/auth/setup', body),
  login: (username, password) => request('POST', '/api/auth/login', { username, password }),
  logout: () => request('POST', '/api/auth/logout', {}),
  signup: (body) => request('POST', '/api/auth/signup', body),
  checkInvite: (token) => request('GET', `/api/auth/invite/${encodeURIComponent(token)}`),
  updateMe: (body) => request('PATCH', '/api/auth/me', body),
  changePassword: (current, next) => request('POST', '/api/auth/password', { current, next }),
  sessions: () => request('GET', '/api/auth/sessions'),
  revokeOtherSessions: () => request('POST', '/api/auth/sessions/revoke-others', {}),

  // workspaces
  workspaces: () => request('GET', '/api/workspaces'),
  createWorkspace: (body) => request('POST', '/api/workspaces', body),
  testGithub: (repoUrl, token) => request('POST', '/api/workspaces/test-github', { repoUrl, token }),
  updateWorkspace: (id, body) => request('PATCH', W(id), body),
  deleteWorkspace: (id) => request('DELETE', W(id)),
  leaveWorkspace: (id) => request('POST', `${W(id)}/leave`, {}),
  tree: (id) => request('GET', `${W(id)}/tree`),
  index: (id) => request('GET', `${W(id)}/index`),
  readNote: (id, path, opts) => request('GET', `${W(id)}/note${q({ path })}`, undefined, opts),
  writeNote: (id, path, content, extra = {}) => request('PUT', `${W(id)}/note`, { path, content, ...extra }),
  createFolder: (id, path) => request('POST', `${W(id)}/folder`, { path }),
  move: (id, from, to, updateLinks = true) => request('POST', `${W(id)}/move`, { from, to, updateLinks }),
  remove: (id, path) => request('DELETE', `${W(id)}/entry${q({ path })}`),
  upload: (id, path, file, unique = true) => request('PUT', `${W(id)}/file${q({ path, unique: unique ? '1' : '' })}`, file, { raw: true }),
  fileUrl: (id, path) => `${W(id)}/file${q({ path })}`,
  search: (id, query, opts) => request('GET', `${W(id)}/search${q({ q: query })}`, undefined, opts),
  backlinks: (id, path) => request('GET', `${W(id)}/backlinks${q({ path })}`),
  toggleTask: (id, path, line, status) => request('POST', `${W(id)}/tasks/toggle`, { path, line, status }),
  history: (id, path) => request('GET', `${W(id)}/history${q({ path })}`),
  version: (id, path, vid, vpath) => request('GET', `${W(id)}/history/version${q({ path, id: vid, vpath })}`),
  restoreVersion: (id, path, vid, vpath) => request('POST', `${W(id)}/history/restore`, { path, id: vid, vpath }),
  sync: (id) => request('POST', `${W(id)}/sync`, {}),
  members: (id) => request('GET', `${W(id)}/members`),
  addMember: (id, username, role) => request('POST', `${W(id)}/members`, { username, role }),
  setMemberRole: (id, userId, role) => request('PATCH', `${W(id)}/members/${userId}`, { role }),
  removeMember: (id, userId) => request('DELETE', `${W(id)}/members/${userId}`),
  shares: (id, path) => request('GET', `${W(id)}/shares${q({ path })}`),
  shareNote: (id, path, username, role) => request('POST', `${W(id)}/shares`, { path, username, role }),
  unshareNote: (id, path, userId) => request('DELETE', `${W(id)}/shares${q({ path, userId })}`),
  publish: (id, path, theme) => request('POST', `${W(id)}/publish`, { path, theme }),
  unpublish: (id, path) => request('DELETE', `${W(id)}/publish${q({ path })}`),
  trash: (id) => request('GET', `${W(id)}/trash`),
  restoreTrash: (id, trashId) => request('POST', `${W(id)}/trash/${trashId}/restore`, {}),
  purgeTrash: (id, trashId) => request('DELETE', `${W(id)}/trash/${trashId}`),
  exportUrl: (id) => `${W(id)}/export`,
  importZip: (id, file, folder) => request('POST', `${W(id)}/import${q({ folder })}`, file, { raw: true }),
  shared: () => request('GET', '/api/shared'),
  users: () => request('GET', '/api/users'),

  // admin
  adminOverview: () => request('GET', '/api/admin/overview'),
  adminStorage: () => request('GET', '/api/admin/storage'),
  adminCreateUser: (body) => request('POST', '/api/admin/users', body),
  adminUpdateUser: (id, body) => request('PATCH', `/api/admin/users/${id}`, body),
  adminDeleteUser: (id) => request('DELETE', `/api/admin/users/${id}`),
  adminCreateInvite: (body) => request('POST', '/api/admin/invites', body),
  adminDeleteInvite: (id) => request('DELETE', `/api/admin/invites/${id}`),
  adminDeleteWorkspace: (id) => request('DELETE', `/api/admin/workspaces/${id}`),
}
