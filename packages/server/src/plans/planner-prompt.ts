import { describeIssue, type PlanIssue } from '@squadboard/core';
import type { AgentView } from '../team/team-service.js';

/**
 * The Planner's task prompt. Its role instructions come from `.claude/agents/planner.md`
 * (`--append-system-prompt`); this part carries what changes per request: the request, the
 * agents it may use and the rules the server enforces anyway.
 */
export function plannerPrompt(request: string, workers: readonly AgentView[]): string {
  const agents = workers
    .map((a) => {
      const owns = a.owns.length ? a.owns.join(', ') : 'belirtilmemiş';
      const shell = a.tools?.includes('Bash')
        ? ' Kabuk: projenin test, lint ve tip kontrolü komutlarını çalıştırabilir.'
        : '';
      return `- ${a.id} (${a.names.tech}): ${a.description}. Sahip olduğu yollar: ${owns}.${shell}`;
    })
    .join('\n');
  return `Kullanıcının isteği:
"""
${request}
"""

Bu isteği aşağıdaki ajanlar için görevlere böl. Yalnızca bu ajanlara görev ver; "agent" alanına ajanın kimliğini yaz. Listede olmayan ajanlar kapalı, onlara görev verme.
${agents}

Kurallar:
- Ajanlar kabukta (terminal) yalnızca projenin test, lint ve tip kontrolü komutlarını çalıştırabilir, o da yalnızca yanında "Kabuk" yazan ajanlar. Paket kurulumu, derleme ya da başka komutlar gerektiren görev yazma ("npm install yap", "derle" gibi). Testleri çalıştırma işini yalnızca kabuğu olan bir ajana ver; öyle bir ajan yoksa görev yalnızca test dosyalarını yazmak olsun.
- "prompt": ajanın başka bir şey okumadan işi yapabileceği açık, Türkçe bir talimat. Kullanıcının kararlarına bağlı kısımları tahmin etme.
- "expectedFiles": değişmesi beklenen dosyalar, repo köküne göre (glob olabilir). Görevi ajanın sahip olduğu yolların içinde tut.
- "dependsOn": bu görevden önce bitmesi gereken görevlerin kimlikleri. Bağımsız görevler paralel çalışır; aynı dosyaya dokunan iki görevi bağımsız bırakma.
- "id": kısa, küçük harf ve tire (ör. "db-users").
- "openDecisions": kullanıcının vermesi gereken, senin tahmin etmemen gereken kararlar (veritabanı türü, kimlik doğrulama yöntemi, tasarım tercihi gibi). Her birinde 2-4 seçenek; "taskIds" etkilenen görevler, tüm planı etkiliyorsa boş liste. Cevabı istekte ya da kodda olan ya da kolayca geri alınabilecek ayrıntıları sorma. Karar yoksa boş liste ver.
- Gereksiz görev ekleme; küçük bir istek tek görev olabilir. En fazla 12 görev.
- Hiçbir dosyayı değiştirme. Önce projeyi oku, sonra planı döndür.`;
}

/** Added on the second attempt, after the first answer did not pass validation. */
export function retryPrompt(issues: readonly PlanIssue[] | string): string {
  const text = typeof issues === 'string' ? issues : issues.map(describeIssue).join('; ');
  return `\n\nÖnceki denemende döndürdüğün plan geçersizdi: ${text}. Bu sorunları düzelterek planı yeniden üret.`;
}
