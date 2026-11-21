import { ArrowRight, Plus, Sparkles } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
import { usePlanActions } from '../../lib/queries';
import { navigate } from '../../lib/router';
import { useUi } from '../../lib/store';
import { Button } from '../../ui/Button';
import { ErrorMessage } from '../../ui/ErrorMessage';

/**
 * "Ekibin hazır." welcome with the one-line request box (v2-01, v2-02, v2-18). "Planla" gives the
 * request to the team's Planner and opens the planning screen; "Tek görev" still opens the
 * single-task dialog for work that needs no plan.
 */
export function Hero({ firstRun, projectId }: { firstRun: boolean; projectId: string }) {
  const [text, setText] = useState('');
  const openNewTask = useUi((s) => s.openNewTask);
  const plans = usePlanActions(projectId);
  const inputId = useId();

  function submit(e: FormEvent) {
    e.preventDefault();
    const request = text.trim();
    if (!request) return;
    plans.start.mutate(request, {
      onSuccess: (plan) => {
        setText('');
        navigate({ plan: plan.id, task: null });
      },
    });
  }

  return (
    <section
      aria-labelledby={`${inputId}-title`}
      className="relative overflow-hidden rounded-[2rem] border border-line bg-surface/80 p-5 shadow-card sm:p-10 lg:pr-[22rem]"
    >
      <h1 id={`${inputId}-title`} className="text-4xl font-extrabold tracking-tight sm:text-5xl">
        Ekibin hazır.
      </h1>
      <p className="mt-2 text-lg text-muted sm:text-xl">
        {firstRun
          ? 'İlk işini ver. Plan çıkar, sen onayla, ajanlar paralel çalışsın.'
          : 'Ne yapılsın? Bir cümleyle anlat, gerisini ekip halleder.'}
      </p>

      <form
        onSubmit={submit}
        className="mt-6 flex items-center gap-2 rounded-2xl border border-line-strong bg-surface p-2 pl-4 focus-within:border-accent focus-within:ring-4 focus-within:ring-accent/15 sm:mt-8"
      >
        <Sparkles aria-hidden className="hidden size-5 shrink-0 text-muted sm:block" />
        <label htmlFor={inputId} className="sr-only">
          Ne yapılsın?
        </label>
        <input
          id={inputId}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={firstRun ? 'Ne yapılsın?' : 'Örn: “Giriş sayfası ve API ekle”'}
          autoComplete="off"
          className="min-h-12 min-w-0 flex-1 bg-transparent text-lg placeholder:text-faint focus:outline-none focus-visible:outline-none"
        />
        <Button
          type="submit"
          variant="primary"
          size="lg"
          trailingIcon={ArrowRight}
          loading={plans.start.isPending}
          disabled={!text.trim()}
          aria-label="Planla"
        >
          <span className="hidden sm:inline">Planla</span>
        </Button>
      </form>

      {plans.start.isError && (
        <ErrorMessage error={plans.start.error} prefix="Planlanamadı:" className="mt-3" />
      )}
      <div className="mt-3 flex flex-wrap items-center gap-x-2 text-sm text-muted">
        <span>Plana gerek yok mu?</span>
        <Button
          variant="ghost"
          icon={Plus}
          onClick={() => {
            openNewTask(text.trim());
            setText('');
          }}
        >
          Tek görev ekle
        </Button>
      </div>

      <HeroArt />
    </section>
  );
}

/** Three tilted pastel tiles and a terminal, as in the design. Decorative. */
function HeroArt() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute top-1/2 right-10 hidden h-64 w-80 -translate-y-1/2 lg:block"
    >
      <div className="absolute top-16 left-0 h-40 w-44 -rotate-6 rounded-[1.75rem] bg-agent-planner/80" />
      <div className="absolute top-0 right-16 h-40 w-48 rotate-6 rounded-[1.75rem] bg-agent-frontend shadow-card" />
      <div className="absolute top-24 right-0 h-40 w-44 rotate-3 rounded-[1.75rem] bg-agent-test/90 shadow-card" />
      <div className="absolute top-36 left-20 flex h-28 w-44 -rotate-3 items-center justify-center rounded-2xl bg-console font-mono text-3xl text-console-ink shadow-pop">
        &gt;_
      </div>
    </div>
  );
}
