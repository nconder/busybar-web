"""Force a new CDN cache entry by modifying the PNG slightly and re-uploading."""
import base64, json, urllib.request, re

HERMES_ENV = "C:\\Users\\nconder\\AppData\\Local\\hermes\\.env"
token = None
with open(HERMES_ENV) as f:
    m = re.search(r'^GITHUB_TOKEN=(ghp_\S+)', f.read(), re.MULTILINE)
    if m: token = m.group(1)

H = {"Authorization": f"token {token}",
     "Accept": "application/vnd.github+json",
     "User-Agent": "hermes-agent",
     "Content-Type": "application/json"}

def api(path, data=None, method="GET"):
    url = f"https://api.github.com/repos/nconder/busybar-web{path}"
    body = json.dumps(data).encode() if data else None
    req = urllib.request.Request(url, data=body, headers=H, method=method)
    resp = urllib.request.urlopen(req, timeout=60)
    return json.loads(resp.read())

# Read original PNG
with open("docs/dashboard.png", "rb") as f:
    png = bytearray(f.read())

# PNG structure: IHDR chunk at offset 16, then IDAT, then IEND
# Add a tEXt chunk before IDAT to force a different blob SHA
# PNG chunk: 4-byte length + 4-byte type + data + 4-byte CRC
# Let's add a simple tEXt chunk with comment "hermes-upload"
text_data = b"hermes-upload"
text_chunk = len(text_data).to_bytes(4, 'big') + b'tEXt' + text_data
# CRC32 of type + data
import zlib
crc = zlib.crc32(b'tEXt' + text_data) & 0xffffffff
text_chunk += crc.to_bytes(4, 'big')

# Insert after IHDR chunk (which is at offset 8-28: 4 len + 4 type + 13 data + 4 crc = 29 bytes, total 33)
# IHDR starts at offset 8, length 13, so IHDR chunk is 4+4+13+4 = 25 bytes, ending at offset 33
# Insert our tEXt chunk at offset 33
new_png = png[:33] + text_chunk + png[33:]

print(f"Original: {len(png)} bytes, Modified: {len(new_png)} bytes")

# Upload the modified PNG
img_b64 = base64.b64encode(new_png).decode()
result = api("/contents/docs/dashboard.png", {
    "message": "Force CDN refresh with modified PNG",
    "content": img_b64
}, "PUT")
print(f"Uploaded: sha={result['content']['sha'][:12]}, size={result['content']['size']}")

# Save the modified version locally
with open("docs/dashboard.png", "wb") as f:
    f.write(new_png)
print("Saved modified PNG locally")

# Verify
import time
time.sleep(3)
info = api("/contents/docs/dashboard.png")
print(f"Verified: {info['size']} bytes, sha={info['sha'][:12]}")
