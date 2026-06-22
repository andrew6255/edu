const fs = require('fs');
const code = fs.readFileSync('c:\\Users\\antoi\\OneDrive\\Desktop\\edu\\artifacts\\web-app\\src\\pages\\SuperAdminPage.tsx', 'utf8');
const newLogicAdmin = fs.readFileSync('c:\\Users\\antoi\\OneDrive\\Desktop\\edu\\artifacts\\web-app\\scratch2.tsx', 'utf8');
const regex = /function LogicGamesAdmin\(\) \{[\s\S]*?\}\s*function ProgramsAdmin\(\) \{/;
if (regex.test(code)) {
  const newCode = code.replace(regex, newLogicAdmin + '\n\nfunction ProgramsAdmin() {');
  fs.writeFileSync('c:\\Users\\antoi\\OneDrive\\Desktop\\edu\\artifacts\\web-app\\src\\pages\\SuperAdminPage.tsx', newCode);
  console.log('Replaced LogicGamesAdmin successfully!');
} else {
  console.log('Regex did NOT match!');
}
