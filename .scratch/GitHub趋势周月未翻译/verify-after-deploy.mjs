// [DEBUG-trendzh] 部署后终验:容器内登录 → GET weekly/monthly 触发生产补译路径。
const base = `http://127.0.0.1:${process.env.PORT ?? 8080}`
const login = await fetch(`${base}/api/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: process.env.U, password: process.env.P }),
})
if (!login.ok) throw new Error(`login HTTP ${login.status}`)
const cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
for (const since of ['weekly', 'monthly']) {
  const r = await fetch(`${base}/api/trending?since=${since}`, { headers: { cookie } })
  const body = await r.json()
  const repos = body.repos ?? []
  console.log(
    `${since}: HTTP ${r.status} 条目 ${repos.length} 已带译文 ${repos.filter((x) => x.descriptionZh).length}`,
  )
}
