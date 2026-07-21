import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getPublishedPosts } from '../src/lib/pocketbase.js';
import { parsePublicHttpsUrl, resolveSourceUrl } from '../src/lib/sourceUrls.js';
import { blogCanonicalForSlug } from '../src/lib/blogUrls.js';

const applyChanges = process.argv.includes('--apply');
const pbUrl = String(process.env.PB_URL || '').trim().replace(/\/$/, '');
const writerEmail = String(process.env.PB_WRITER_EMAIL || '').trim();
const writerPassword = String(process.env.PB_WRITER_PASSWORD || '');
const reportDir = resolve('reports');

const replacements = {
  'moonshot-kimi-k3-open-weights-infrastructure-analysis': [
    ['https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQG-LKxFPgdfZh8W2nadaUoHAJG-K5Ry2m8SQCSIuWHvSlBJBRANE8UKAiF0xwGgglOBOq2RIAiUqzlMPtFn3DzFHnUkNsC4mhIfbp9thJ2FnUDlPJLgX3zl4kjOuQPnVCwCpE66EHeRCGBwU3q_kHf10YBIY1awdbSUfqsYUz5ybkU=', 'https://www.kimi.com/blog/kimi-k3', 'Official Kimi K3 technical announcement.'],
    ['https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQEIve6oOAFANTGBEHwg7HKhjpSduEYD-pHzQWh-PctpDY_iPMwB9RVqBQ9ikVWFMhQObFCk_j7Djuq706zdxkqAsm2ow6Eh2YtDhJlgyKWGVxek8TtPOH9z90rxV7Iy8DdDkVwcXZRHkzWjzCAECiHSohNZeEq2Q5piPg==', 'https://docs.vllm.ai/en/latest/serving/parallelism_scaling/', 'Primary vLLM documentation for distributed serving and parallelism.'],
  ],
  'retiring-kerberos-rc4-cve-2026-20833': [
    ['https://example.com/rc4-going-away-july-2026-cve-2026-20833', 'https://learn.microsoft.com/en-us/windows-server/security/kerberos/detect-remediate-rc4-kerberos', 'Official Microsoft remediation guidance for Kerberos RC4.'],
  ],
  'whitefiber-cross-data-center-gpu-supercluster-architecture': [
    ['https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQF8PCKo6O45pnpIr19NpUvtM6SqgkKjPk5lNBsEyXn_9j783-4SiFPy6rWPV2ayTHisgC5N99Jz4iP5o6aaz4BO3-MrZqiCxMAj8SwpcInpHvRE33Piteq3wOiS', 'https://www.whitefiber.com/blog/cross-data-center-networking-solution', 'Official WhiteFiber announcement and measured results.'],
    ['https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYG4AoZ1bxI2JsLLxAPLPNfMOk1GVwU2oq11s4Vd7_KWSZ_yukqLhaW-m1mkq_Q5OKpcTIxHOMYya-zEQuLbPG07pOAp46tKDTNEst7NP1roByRzm2LdJ4VK2L2wXrBGWpsU7Gef6L_t6TGER5egDB1O1xM6qFEkyBKkKzyTbxRcUbTYUno23tN6OUWeXOFYnID36DRxReTsolbYcTwK0wHJ_UPh_vIss5IILqE70iiRJORjQaQW387Ysx0J2R17moP-bTXrOcb1nydQPaxI4wxPoEVqAdBkd5qhExA=', 'https://www.whitefiber.com/distributed-cluster-networking', 'Official WhiteFiber technical overview for the deployment.'],
  ],
  'rogue-agent-vulnerability-ai-agent-security-risks': [
    ['https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQFmtD1HxmkJ_y70EiEizfQfXy3U7kmE8EIETeHHnoHH4UkQXYbTG_EGEbgj4Q-slXBVY1FTcu36GEb2IzL-2XE4i8S92NuzcKwwtunkG16IT3IhXwCIzSpcKhoORErvQAmTPk-GgUnZlM6x0vnNefdqYanzDIG27BjePBvrpcELsylj44n-AWWtTQ544r3D', 'https://www.varonis.com/blog/rogue-agent-dialogflow-attack', 'Original Varonis Threat Labs disclosure.'],
    ['https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQF770uB2W4Q6QHFTDwGauFD8FFehHIG_NihevEuoFcUoKu8LBoigCcx_4_BDDAfmDNv_aG289PAdUtwULMXfyXVSlTCJ9NLtTn6eEUCFkGaMrgu2OLVII-Hqx80pAEFsCe_sqRevc0lYPVpTLYj0xjwpw7pmJg70_4=', 'https://www.cycognito.com/learn/ai-security/ai-agent-security/', 'Supporting AI-agent security guidance.'],
  ],
  'evolving-role-of-rag-in-agentic-ai-systems': [
    ['https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQGhrcnMZwepz1zCZaLpw8-vx6R70KLtVROjHt4ZQ3v5R3m9qDVWNSFbrucGiyIgJpBhMDhJOUqGxj_fb5AhWZf12dieMXDAOPJ9sXPTOFEDcOk=', 'https://arxiv.org/abs/2005.11401', 'Original Retrieval-Augmented Generation research paper.'],
    ['https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQHS8NU8Vmxut4QIoik_oO8GE8XcBiiJzf3S7A4LDrs4WX7oESDGV6In0NcM92RleNFUuL38sET3au7a1HBPL_8op8aE3vKbk8GyBwj2dP4jVnVnZ1WGNpKRtnq96k3qx0z-7VM9DmxldOjrsmdGu5be7qtJqEXt5GsYgdsOaKNqN2ugIDKPzbZR5mPXrDEM1dEZwEDw9ccJTJdvLA==', 'https://docs.langchain.com/oss/python/langgraph/agentic-rag', 'Primary LangGraph agentic RAG implementation guide.'],
    ['https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQH27oUutkpeuoOtJxJfZOI-w-JP-KG1PLVZzkMJSfbXKO9h4JVdHkDYFKvPOP2ko5P8HLiKERan_lbhne41I8oiYd-ivZ-dUS_ksUf1hY_hzOtu-Lw1igRR0wk3y9n7-UIdbfvB0ycVsbRvUvg6MoieJervZG0mcHMs8u5PhP7gJA4U25xuQvxm7F0BVEPqQOtfBTYmlHM4c3V0Ahumcvk=', 'https://arxiv.org/abs/2307.03172', 'Primary research on long-context retrieval limitations.'],
  ],
  'api-security-agentic-era-autonomous-ai-workflows': [
    ['https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQFDR8XGPfEKrkf60gRVqaEjBcF5WxCByDwZw1PdGT3G25JMi4UTehZNjq5s_nGC8jMIkx_qgujiEe_zoxvySgXMhY8Lj7-uVvOw_EYO53ByeSMiZfb8bvwNvTqPMgQgAB4OTtBktQ==', 'https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html', 'OWASP primary guidance for AI-agent security controls.'],
  ],
  'prompt-to-production-ai-coding-agents-devops': [
    ['https://www.infoq.com/news/...', 'https://github.blog/ai-and-ml/generative-ai/continuous-ai-in-practice-what-developers-can-automate-today-with-agentic-ci/', 'GitHub engineering guidance on agentic CI.'],
    ['https://github.blog/engineering/...', 'https://docs.github.com/en/copilot/using-github-copilot/using-copilot-coding-agent-to-work-on-tasks/best-practices-for-using-copilot-to-work-on-tasks', 'Official GitHub coding-agent workflow guidance.'],
    ['https://ieeexplore.ieee.org/document/...', 'https://csrc.nist.gov/projects/ssdf', 'NIST Secure Software Development Framework.'],
    ['https://www.technologyreview.com/...', 'https://www.nccoe.nist.gov/projects/secure-software-development-security-and-operations-devsecops-practices', 'NIST NCCoE DevSecOps practices.'],
    ['https://www.datadoghq.com/blog/...', 'https://github.blog/changelog/2026-06-09-security-validation-for-third-party-coding-agents/', 'Official GitHub security validation announcement.'],
    ['https://newrelic.com/blog/...', 'https://docs.github.com/en/enterprise-cloud@latest/copilot/concepts/agents/cloud-agent/risks-and-mitigations', 'Official GitHub coding-agent risk controls.'],
    ['https://www.saassecurityforum.org/...', 'https://cheatsheetseries.owasp.org/cheatsheets/Secure_Coding_with_AI_Cheat_Sheet.html', 'OWASP secure coding with AI guidance.'],
    ['https://owasp.org/blog/...', 'https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html', 'OWASP AI-agent security guidance.'],
  ],
};

function tableCell(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
}

async function authenticateWriter() {
  if (!pbUrl || !writerEmail || !writerPassword) throw new Error('PB_URL, PB_WRITER_EMAIL, and PB_WRITER_PASSWORD are required for --apply.');
  const response = await fetch(`${pbUrl}/api/collections/blog_authors/auth-with-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity: writerEmail, password: writerPassword }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.token || data.record?.verified !== true) throw new Error(`Writer authentication failed (${response.status}).`);
  return data.token;
}

await mkdir(reportDir, { recursive: true });
const posts = await getPublishedPosts(500);
const postsBySlug = new Map(posts.map((post) => [post.slug, post]));
const rows = [];
const prepared = [];

for (const [slug, changes] of Object.entries(replacements)) {
  const post = postsBySlug.get(slug);
  if (!post) throw new Error(`Published post not found: ${slug}`);
  const nextUrls = [...(post.source_urls || [])];

  for (const [previous, replacement, reason] of changes) {
    const index = nextUrls.indexOf(previous);
    if (index === -1) {
      rows.push([blogCanonicalForSlug(slug), previous, replacement, 'Already repaired or source changed', reason]);
      continue;
    }
    if (!parsePublicHttpsUrl(replacement)) throw new Error(`Replacement is not a public HTTPS URL: ${replacement}`);
    const validation = await resolveSourceUrl(replacement, 12000);
    if (!validation.resolved) throw new Error(`Replacement did not return a valid public response: ${replacement} (${validation.reason})`);
    nextUrls[index] = validation.resolved;
    rows.push([blogCanonicalForSlug(slug), previous, validation.resolved, applyChanges ? 'Repaired' : 'Validated (dry run)', reason]);
  }

  prepared.push({ post, sourceUrls: Array.from(new Set(nextUrls)) });
}

if (applyChanges) {
  const token = await authenticateWriter();
  const backup = prepared.map(({ post }) => ({
    recordId: post.id,
    slug: post.slug,
    title: post.title,
    publicationDate: post.published_at,
    sourceUrls: post.source_urls,
  }));
  await writeFile(resolve(reportDir, 'source-link-repair-backup.json'), `${JSON.stringify({ createdAt: new Date().toISOString(), posts: backup }, null, 2)}\n`, 'utf8');

  for (const { post, sourceUrls } of prepared) {
    const response = await fetch(`${pbUrl}/api/collections/posts/records/${post.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ source_urls: sourceUrls }),
    });
    if (!response.ok) throw new Error(`PocketBase update failed for ${post.slug} (${response.status}): ${await response.text()}`);
  }
}

const header = ['Post URL', 'Previous source URL', 'Replacement URL', 'Status', 'Reason'];
const markdown = [
  '# Source Link Repair Results',
  '',
  `Generated: ${new Date().toISOString()}`,
  '',
  `Mode: ${applyChanges ? 'Applied to PocketBase' : 'Validation only'}`,
  '',
  `| ${header.join(' | ')} |`,
  `| ${header.map(() => '---').join(' | ')} |`,
  ...rows.map((row) => `| ${row.map(tableCell).join(' | ')} |`),
  '',
  '> Only source_urls fields were updated. Slugs, titles, publication dates, status, canonical URLs, and post bodies were not changed.',
  '',
].join('\n');
await writeFile(resolve(reportDir, 'source-link-repair-results.md'), markdown, 'utf8');
console.log(`${applyChanges ? 'Applied' : 'Validated'} ${rows.length} source-link repairs across ${prepared.length} posts.`);
