import fs from 'node:fs';
import { PDFParse } from 'pdf-parse';

const input = 'C:/Users/isuvo/Desktop/original resume shuvo.pdf';
const output = 'C:/HomeServer/ops/site/resume-extract.txt';

const buffer = fs.readFileSync(input);
const parser = new PDFParse({ data: buffer });
const data = await parser.getText();
await parser.destroy();

fs.writeFileSync(output, data.text, 'utf8');
process.stdout.write(data.text);
