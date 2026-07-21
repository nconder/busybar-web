"""Create a GitHub repo for busybar-web and push the code using the token
from the Hermes .env file."""
import os, re, subprocess, json, urllib.request

HERMES_ENV = os.path.expanduser("~/AppData/Local/hermes/.env")

# 1. Read the GitHub token from the Hermes env file
token = None
with open(HERMES_ENV) as f:
    for line in f:
        m = re.match(r'^GITHUB_TOKEN=(.+)$', line.strip())
        if m:
            token = m.group(1).strip()
            break

if not token or token.startswith('ghp_Yw...'):
    # token is masked in our read; try the real file
    print("Token appears masked, reading raw...")
    with open(HERMES_ENV) as f:
        content = f.read()
    m = re.search(r'^GITHUB_TOKEN=(ghp_\S+)', content, re.MULTILINE)
    if m:
        token = m.group(1)

if not token:
    print("ERROR: no GitHub token found in .env")
    exit(1)

print(f"Token found: {token[:10]}...{token[-4:]}")

# 2. Get the authenticated user's GitHub username
req = urllib.request.Request("https://api.github.com/user",
                             headers={"Authorization": f"token {token}",
                                      "Accept": "application/vnd.github+json",
                                      "User-Agent": "hermes-agent"})
try:
    resp = urllib.request.urlopen(req, timeout=30)
    user_data = json.loads(resp.read())
    username = user_data["login"]
    print(f"Authenticated as: {username}")
except Exception as e:
    print(f"Auth failed: {e}")
    exit(1)

# 3. Create the repo (public, with README)
repo_name = "busybar-web"
repo_data = json.dumps({
    "name": repo_name,
    "description": "Local web console for the BUSY Bar device — drives every cloud API feature from one browser page",
    "homepage": "https://busy.app/",
    "private": False,
    "auto_init": True,
    "gitignore_template": "Python",
    "license_template": "MIT",
    "topics": ["busy-bar", "iot", "flask", "api-client", "pomodoro", "matter", "home-automation"]
}).encode()

create_req = urllib.request.Request(
    "https://api.github.com/user/repos",
    data=repo_data,
    headers={"Authorization": f"token {token}",
             "Accept": "application/vnd.github+json",
             "User-Agent": "hermes-agent",
             "Content-Type": "application/json"},
    method="POST")

try:
    resp = urllib.request.urlopen(create_req, timeout=30)
    repo = json.loads(resp.read())
    print(f"Repo created: {repo['html_url']}")
except urllib.error.HTTPError as e:
    body = e.read().decode()
    if "already exists" in body:
        print(f"Repo already exists: https://github.com/{username}/{repo_name}")
    else:
        print(f"Create failed: {e.code} {body}")
        exit(1)

# 4. Now init the local git repo and push
repo_path = os.path.expanduser("~/Documents/source/hermes/busybar-web")
remote_url = f"https://{username}:{token}@github.com/{username}/{repo_name}.git"

# git init
subprocess.run(["git", "init"], cwd=repo_path, check=True, capture_output=True)

# Configure git
subprocess.run(["git", "config", "user.name", "noreply"], cwd=repo_path, check=True, capture_output=True)
subprocess.run(["git", "config", "user.email", "noreply@noreply.com"], cwd=repo_path, check=True, capture_output=True)

# Remove the default README if auto_init created one (we have our own)
readme_path = os.path.join(repo_path, "README.md")
if os.path.exists(readme_path):
    # Our README is better, keep it
    pass

# Create a .gitignore
gitignore = """# Python
__pycache__/
*.py[cod]
*$py.class
*.so
*.egg-info/
dist/
build/
.eggs/

# Virtual environments
venv/
.venv/
env/

# IDE
.vscode/
.idea/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# Hermes
.hermes/
"""
with open(os.path.join(repo_path, ".gitignore"), "w") as f:
    f.write(gitignore)

# Add all files
subprocess.run(["git", "add", "-A"], cwd=repo_path, check=True, capture_output=True)

# Commit
result = subprocess.run(
    ["git", "commit", "-m", "Initial commit: BUSY Bar Mission Control web app"],
    cwd=repo_path, check=True, capture_output=True, text=True)
print(f"Committed: {result.stdout.strip()}")

# Add remote
subprocess.run(["git", "remote", "add", "origin", remote_url],
               cwd=repo_path, check=True, capture_output=True)

# Push
result = subprocess.run(
    ["git", "push", "-u", "origin", "main"],
    cwd=repo_path, check=True, capture_output=True, text=True)
print(f"Pushed: {result.stdout.strip()}")
print(f"\nRepo URL: https://github.com/{username}/{repo_name}")
