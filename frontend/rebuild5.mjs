import fs from 'fs';
let code = fs.readFileSync('/mnt/user-data/outputs/costlens-final.jsx', 'utf8');
code = code.replace('import { useState, useEffect, useRef } from "react";','const { useState, useEffect, useRef } = React;');
code = code.replace('export default function App()','function App()');

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>CostLens — AI-Powered Procurement Costing Platform</title>
  <meta name="description" content="Zero-based costing tools, AI analysis reports, commodity intelligence, and AI commercial tools for Indian manufacturing procurement."/>
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 56 56'%3E%3Ccircle cx='22' cy='22' r='16' stroke='%232d7ff9' stroke-width='3' fill='none'/%3E%3Cline x1='33' y1='33' x2='44' y2='44' stroke='%232d7ff9' stroke-width='3' stroke-linecap='round'/%3E%3Crect x='12' y='16' width='5.5' height='12' rx='1.5' fill='%232E86C1' opacity='.9'/%3E%3Crect x='19' y='19' width='5.5' height='9' rx='1.5' fill='%2310B981' opacity='.9'/%3E%3Crect x='26' y='13' width='5.5' height='15' rx='1.5' fill='%23F59E0B' opacity='.9'/%3E%3C/svg%3E"/>
  <script crossorigin src="https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js"><\/script>
  <script crossorigin src="https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js"><\/script>
  <script crossorigin src="https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/7.26.4/babel.min.js"><\/script>
</head>
<body>
  <div id="root"></div>
  <script type="text/babel" data-type="module">
${code}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App/>);
  <\/script>
</body>
</html>`;

fs.writeFileSync('/mnt/user-data/outputs/costlens-final.html', html);

const babelStart = html.indexOf('type="text/babel"');
const babelEnd = html.lastIndexOf('</script>');
const codeBody = html.slice(babelStart, babelEnd);
let ob=0,cb=0;for(const ch of codeBody){if(ch==='{')ob++;if(ch==='}')cb++}
console.log('HTML:', (html.length/1024).toFixed(1), 'KB');
console.log('Lines:', html.split('\n').length);
console.log('Braces:', ob===cb?'BALANCED':'UNBALANCED');
console.log('Script closes inside:', (codeBody.match(/<\/script>/g)||[]).length);
console.log('window.storage:', (html.match(/window\.storage/g)||[]).length, '(should be 0)');
console.log('localStorage:', (html.match(/localStorage/g)||[]).length);
console.log('YOUR-API-KEY-HERE:', (html.match(/YOUR-API-KEY-HERE/g)||[]).length);
console.log('Build complete');
