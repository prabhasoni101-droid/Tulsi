import fs from 'fs';
import path from 'path';

const output = 'full_source_code.txt';
let content = '# Full Source Code\n\n';

function walkDir(dir) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
            walkDir(fullPath);
        } else if (fullPath.endsWith('.ts') || fullPath.endsWith('.tsx') || fullPath.endsWith('.css')) {
            content += `## File: ${fullPath}\n\`\`\`\n${fs.readFileSync(fullPath, 'utf8')}\n\`\`\`\n\n`;
        }
    }
}

walkDir('src');
content += `## File: index.html\n\`\`\`html\n${fs.readFileSync('index.html', 'utf8')}\n\`\`\`\n\n`;
content += `## File: package.json\n\`\`\`json\n${fs.readFileSync('package.json', 'utf8')}\n\`\`\`\n\n`;

fs.writeFileSync(output, content);
console.log('Source code exported to ' + output);
