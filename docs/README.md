# Documentos do projeto

O **PRD** é a fonte de verdade do DevLab; o **Prompt-Mestre** é derivado dele.
Coloque os dois aqui para que o repositório fique autocontido:

```
docs/
├── PRD-DevLab-v2-FINAL.md            ← fonte de verdade
└── Prompt-Mestre-DevLab-v2-FINAL.md  ← derivado do PRD
```

Regra de manutenção, herdada do próprio Prompt-Mestre: **ao expandir uma
trilha, atualize primeiro o PRD** e só então regenere a seção correspondente do
prompt. O código e o conteúdo em `content/` seguem o PRD, nunca o contrário.

## Rastreabilidade da Fase 0

| Seção do PRD | Onde vive no código |
|---|---|
| §4.2 Lab Manager | `packages/agent/src/lab/gerenciador.ts` |
| §4.2 PTY Bridge | `packages/agent/src/http/pty.ts` |
| §4.2 Verifier Runner | `packages/agent/src/verificacao/executor.ts` |
| §4.2 State Extractor | `packages/agent/src/estado/extrator.ts` |
| §4.2 Progress Store | `packages/agent/src/progresso/store.ts` |
| §4.3 Imagens de lab | `images/linux-base/` |
| §4.4 Verificação de tarefas | `content/trilhas/linux/**` (campo `verificar`) |
| §4.5 Reset e injeção de falha | `gerenciador.ts` → `reiniciar()`, campo `lab.break` |
| §4.7 Segurança e isolamento | `packages/agent/src/lab/limites.ts` |
| §4.8 `devlab doctor` | `packages/agent/src/doctor.ts` |
| §6 Progressão e capacidades | `content/trilhas/linux/trilha.yaml`, campo `capacidade` |
| §7 Trilha A · Operador | `content/trilhas/linux/operador/` |
| §9.2 Catálogo de erros | `content/catalogo/linux.yaml` |
| §12 Modelo de conteúdo | `packages/agent/src/conteudo/schema.ts` |
