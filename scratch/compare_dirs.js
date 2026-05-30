const fs = require('fs');
const path = require('path');

const dir1 = '/Users/apple/antigravity/Sunchaser-Energy-Systems';
const dir2 = '/Users/apple/antigravity/Sunchaser-Energy-Systems/sunchaser-crm';

function compareDirs(currentDir) {
  const files = fs.readdirSync(currentDir);
  for (const file of files) {
    const p1 = path.join(currentDir, file);
    const rel = path.relative(dir1, p1);
    
    // Ignore patterns
    if (rel.includes('node_modules') || rel.includes('.git') || rel.includes('sunchaser-crm') || 
        rel.includes('node-env') || rel.includes('dist') || rel.includes('backups') || 
        rel.includes('.antigravity') || rel.includes('.DS_Store') || file.endsWith('.zip') || 
        file.endsWith('.log') || rel.includes('scratch')) {
      continue;
    }
    
    const stat = fs.statSync(p1);
    if (stat.isDirectory()) {
      compareDirs(p1);
    } else {
      const p2 = path.join(dir2, rel);
      if (!fs.existsSync(p2)) {
        console.log(`Only in parent: ${rel}`);
      } else {
        const c1 = fs.readFileSync(p1);
        const c2 = fs.readFileSync(p2);
        if (!c1.equals(c2)) {
          console.log(`Different: ${rel}`);
        }
      }
    }
  }
}

compareDirs(dir1);
