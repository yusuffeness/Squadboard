import type { ProjectSettings } from '@squadboard/core';
import { Switch } from '../../ui/Switch';
import { Segmented } from '../../ui/Tabs';

const CONCURRENCY = ['1', '2', '3', '4', '5'] as const;

/**
 * Concurrency and the three switches of `.team/team.json` settings (v2-07). Planning and review
 * are stored now and used when the Planner and Reviewer flows arrive; worktrees stay on, since
 * agents must never write to the user's own folder.
 */
export function TeamSettingsForm({
  value,
  onChange,
  disabled = false,
}: {
  value: ProjectSettings;
  onChange: (patch: Partial<ProjectSettings>) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center justify-between gap-3 py-2">
        <div className="min-w-0">
          <p className="font-bold">Aynı anda çalışan ajan</p>
          <p className="text-sm text-muted">
            Birbirini beklemeyen işler en fazla bu kadar paralel yürür.
          </p>
        </div>
        <Segmented
          label="Aynı anda çalışan ajan"
          kind="choice"
          items={CONCURRENCY.map((n) => ({ id: n, label: n }))}
          value={
            String(Math.min(Math.max(value.concurrency, 1), 5)) as (typeof CONCURRENCY)[number]
          }
          onChange={(n) => {
            if (!disabled) onChange({ concurrency: Number(n) });
          }}
        />
      </div>
      <SettingRow
        label="Plan onayı"
        hint="Planlayıcının çıkardığı planı başlamadan önce sen onaylarsın."
        checked={value.requirePlanApproval}
        onChange={(v) => onChange({ requirePlanApproval: v })}
        disabled={disabled}
      />
      <SettingRow
        label="İnceleme"
        hint="Biten iş, sen onaylamadan önce İnceleyici'den geçer."
        checked={value.requireReview}
        onChange={(v) => onChange({ requireReview: v })}
        disabled={disabled}
      />
      <SettingRow
        label="Ayrı çalışma klasörü (worktree)"
        hint="Her görev kendi dalında ve klasöründe çalışır, senin klasörüne yazılmaz. Şimdilik hep açık."
        checked={value.worktrees}
        onChange={() => undefined}
        disabled
      />
    </div>
  );
}

function SettingRow({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-line py-2">
      <div className="min-w-0">
        <p className="font-bold">{label}</p>
        <p className="text-sm text-muted">{hint}</p>
      </div>
      <Switch checked={checked} onChange={onChange} label={label} disabled={disabled} />
    </div>
  );
}
