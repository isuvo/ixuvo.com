type RelatedPost = { slug: string; anchor: string };
type RelatedPostGroup = { cluster: string; links: RelatedPost[] };

export const relatedPosts: Record<string, RelatedPostGroup> = {
  'evolving-role-of-rag-in-agentic-ai-systems': {
    cluster: 'AI SaaS and Agentic Systems',
    links: [
      { slug: 'api-security-agentic-era-autonomous-ai-workflows', anchor: 'secure APIs for autonomous AI workflows' },
      { slug: '95-ai-agent-pilots-zero-roi-production', anchor: 'moving AI agent pilots into production' },
      { slug: 'aws-launches-self-hosted-claude-apps-gateway-ai-governance', anchor: 'governed enterprise AI agent gateways' },
    ],
  },
  '95-ai-agent-pilots-zero-roi-production': {
    cluster: 'AI SaaS and Agentic Systems',
    links: [
      { slug: 'evolving-role-of-rag-in-agentic-ai-systems', anchor: 'agentic retrieval architecture' },
      { slug: 'api-security-agentic-era-autonomous-ai-workflows', anchor: 'production agent API security' },
      { slug: 'aws-launches-self-hosted-claude-apps-gateway-ai-governance', anchor: 'enterprise AI agent governance' },
    ],
  },
  'aws-launches-self-hosted-claude-apps-gateway-ai-governance': {
    cluster: 'AI SaaS and Agentic Systems',
    links: [
      { slug: '95-ai-agent-pilots-zero-roi-production', anchor: 'production-ready AI agent programs' },
      { slug: 'evolving-role-of-rag-in-agentic-ai-systems', anchor: 'RAG within agentic systems' },
      { slug: 'api-security-agentic-era-autonomous-ai-workflows', anchor: 'least-privilege agent API design' },
    ],
  },
  'securing-boundary-zero-day-api-gateways': {
    cluster: 'Software Architecture, Cloud, and DevSecOps',
    links: [
      { slug: 'vault-kubernetes-kms-v2-beta-analysis', anchor: 'secure Kubernetes secrets and etcd encryption' },
      { slug: 'aws-security-hub-native-azure-guardduty-ai-protection', anchor: 'multi-cloud security operations' },
      { slug: 'whitefiber-cross-data-center-gpu-supercluster-architecture', anchor: 'cross-data-center AI infrastructure' },
    ],
  },
  'vault-kubernetes-kms-v2-beta-analysis': {
    cluster: 'Software Architecture, Cloud, and DevSecOps',
    links: [
      { slug: 'securing-boundary-zero-day-api-gateways', anchor: 'API gateway vulnerability mitigation' },
      { slug: 'aws-security-hub-native-azure-guardduty-ai-protection', anchor: 'cloud-native threat detection' },
      { slug: 'whitefiber-cross-data-center-gpu-supercluster-architecture', anchor: 'distributed AI infrastructure architecture' },
    ],
  },
  'whitefiber-cross-data-center-gpu-supercluster-architecture': {
    cluster: 'Software Architecture, Cloud, and DevSecOps',
    links: [
      { slug: 'vault-kubernetes-kms-v2-beta-analysis', anchor: 'Kubernetes KMS and encryption architecture' },
      { slug: 'securing-boundary-zero-day-api-gateways', anchor: 'secure API gateway boundaries' },
      { slug: 'aws-security-hub-native-azure-guardduty-ai-protection', anchor: 'AWS and Azure security integration' },
    ],
  },
  'rogue-agent-vulnerability-ai-agent-security-risks': {
    cluster: 'AI Security and Research',
    links: [
      { slug: 'securing-ai-orchestrators-langflow-idor-cve-2026-55255', anchor: 'secure AI agent orchestration' },
      { slug: 'api-security-agentic-era-autonomous-ai-workflows', anchor: 'API controls for autonomous agents' },
      { slug: 'zero-trust-devsecops-securing-modern-software-delivery-pipeline', anchor: 'zero-trust DevSecOps practices' },
    ],
  },
  'securing-ai-orchestrators-langflow-idor-cve-2026-55255': {
    cluster: 'AI Security and Research',
    links: [
      { slug: 'rogue-agent-vulnerability-ai-agent-security-risks', anchor: 'cloud AI agent security risks' },
      { slug: 'api-security-agentic-era-autonomous-ai-workflows', anchor: 'defensive API design for AI agents' },
      { slug: 'evolving-role-of-rag-in-agentic-ai-systems', anchor: 'retrieval in agentic architectures' },
    ],
  },
  'api-security-agentic-era-autonomous-ai-workflows': {
    cluster: 'AI Security and Research',
    links: [
      { slug: 'rogue-agent-vulnerability-ai-agent-security-risks', anchor: 'Rogue Agent vulnerability analysis' },
      { slug: 'securing-ai-orchestrators-langflow-idor-cve-2026-55255', anchor: 'Langflow orchestrator security' },
      { slug: 'securing-boundary-zero-day-api-gateways', anchor: 'zero-day API gateway mitigation' },
    ],
  },
};
