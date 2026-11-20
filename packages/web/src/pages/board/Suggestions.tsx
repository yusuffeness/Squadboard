import { useAgents, type Agents } from '../../lib/agents';
import { useUi } from '../../lib/store';
import { AgentAvatar } from '../../ui/AgentAvatar';

const IDEAS = [
  {
    agent: 'frontend',
    title: 'Giriş sayfası ekle',
    hint: 'Form, doğrulama ve hata mesajları',
    prompt: 'Giriş sayfası ekle: e-posta ve şifre formu, doğrulama ve anlaşılır hata mesajları.',
  },
  {
    agent: 'backend',
    title: 'REST API yaz',
    hint: 'Uç noktalar ve testler',
    prompt: 'Projenin ana kaynağı için REST API uç noktalarını ve testlerini yaz.',
  },
  {
    agent: 'database',
    title: 'Veri modelini kur',
    hint: 'Tablolar ve örnek veri',
    prompt: 'Veri modelini kur: tabloları oluştur ve örnek veri ekle.',
  },
  {
    agent: 'test',
    title: 'Eksik testleri yaz',
    hint: 'Kapsamı artır',
    prompt: 'Testi olmayan önemli kodlar için eksik testleri yaz.',
  },
] as const;

/** "Buradan başlayabilirsin" ideas for a project with no tasks yet (v2-02). */
/** The idea's role if the team has it, else its first hand-assignable member (e.g. Geliştirici). */
function agentFor(role: string, agents: Agents) {
  const ids = agents.assignable.map((a) => a.id);
  if (ids.includes(role)) return role;
  return agents.assignable.find((a) => a.id !== 'general')?.id ?? 'general';
}

export function Suggestions() {
  const openNewTask = useUi((s) => s.openNewTask);
  const agents = useAgents();
  return (
    <section aria-labelledby="ideas-heading" className="flex flex-col gap-4">
      <h2 id="ideas-heading" className="text-xl font-extrabold">
        Buradan başlayabilirsin
      </h2>
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {IDEAS.map((idea) => (
          <li key={idea.title}>
            <button
              type="button"
              onClick={() => openNewTask(idea.prompt, agentFor(idea.agent, agents))}
              className="flex h-full min-h-11 w-full flex-col items-start gap-3 rounded-card border border-line bg-surface/90 p-5 text-left shadow-card transition-colors hover:border-line-strong"
            >
              <AgentAvatar agent={agents.byId(agentFor(idea.agent, agents))} />
              <span className="text-lg font-extrabold">{idea.title}</span>
              <span className="text-muted">{idea.hint}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
