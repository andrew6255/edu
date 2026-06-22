path = r'c:\Users\antoi\OneDrive\Desktop\edu\artifacts\web-app\src\views\NotificationsView.tsx'
with open(path, 'r', encoding='utf-8') as f:
    code = f.read()

old = "              {n.type === 'lobbyInvite' && !n.resolved && ("

new = """              {n.type === 'lobbyJoinRequest' && !n.resolved && (
                <div style={{ display: 'flex', gap: 10 }}>
                  <button
                    onClick={() => handleJoinRequest(n, true)}
                    className="ll-btn ll-btn-primary"
                    style={{ flex: 1, padding: '8px' }}
                  >
                    \u2705 Accept
                  </button>
                  <button
                    onClick={() => handleJoinRequest(n, false)}
                    className="ll-btn"
                    style={{ flex: 1, padding: '8px', background: 'rgba(239,68,68,0.1)', borderColor: 'rgba(239,68,68,0.3)', color: '#ef4444' }}
                  >
                    Decline
                  </button>
                </div>
              )}

              {n.type === 'lobbyInvite' && !n.resolved && ("""

if old in code:
    code = code.replace(old, new)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(code)
    print("Done")
else:
    print("NOT FOUND")
    lines = code.split('\n')
    for i, l in enumerate(lines):
        if 'lobbyInvite' in l:
            print(f'{i+1}: {l}')
