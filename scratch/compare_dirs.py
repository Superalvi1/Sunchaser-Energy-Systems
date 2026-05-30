import os
import filecmp

dir1 = '/Users/apple/antigravity/Sunchaser-Energy-Systems'
dir2 = '/Users/apple/antigravity/Sunchaser-Energy-Systems/sunchaser-crm'

diff_files = []

for root, dirs, files in os.walk(dir1):
    # Ignore node_modules, .git, sunchaser-crm, node-env, dist, backups
    if 'node_modules' in root or '.git' in root or 'sunchaser-crm' in root or 'node-env' in root or 'dist' in root or 'backups' in root or '.antigravity' in root:
        continue
    for file in files:
        if file.endswith('.DS_Store') or file.endswith('.zip') or file.endswith('.log'):
            continue
        path1 = os.path.join(root, file)
        rel_path = os.path.relpath(path1, dir1)
        path2 = os.path.join(dir2, rel_path)
        if not os.path.exists(path2):
            print(f"Only in parent: {rel_path}")
        else:
            if not filecmp.cmp(path1, path2, shallow=False):
                print(f"Different: {rel_path}")
