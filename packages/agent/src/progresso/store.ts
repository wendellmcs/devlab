import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { log } from '../log.ts'
import { resolvidaSemAjuda, xpDaConclusao } from './regras.ts'

export type EstadoLicao = 'nao_iniciada' | 'em_andamento' | 'concluida'

export type ProgressoLicao = {
  licaoId: string
  trilha: string
  estado: EstadoLicao
  tentativas: number
  dicaMaxima: number
  usouIa: boolean
  xpGanho: number
  semAjuda: boolean
  primeiraEm: number | null
  concluidaEm: number | null
}

export type ResumoProgresso = {
  xpTotal: number
  licoesConcluidas: number
  licoesSemAjuda: number
  tentativasTotais: number
  porTrilha: { trilha: string; concluidas: number; xp: number }[]
}

const ESQUEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS aluno (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  nome       TEXT    NOT NULL DEFAULT 'aluno',
  criado_em  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS licao_progresso (
  licao_id      TEXT PRIMARY KEY,
  trilha        TEXT    NOT NULL,
  estado        TEXT    NOT NULL DEFAULT 'em_andamento',
  tentativas    INTEGER NOT NULL DEFAULT 0,
  dica_maxima   INTEGER NOT NULL DEFAULT 0,
  usou_ia       INTEGER NOT NULL DEFAULT 0,
  xp_ganho      INTEGER NOT NULL DEFAULT 0,
  sem_ajuda     INTEGER NOT NULL DEFAULT 0,
  primeira_em   INTEGER,
  concluida_em  INTEGER,
  atualizada_em INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tentativa (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  licao_id    TEXT    NOT NULL,
  aprovada    INTEGER NOT NULL,
  duracao_ms  INTEGER NOT NULL,
  checks_json TEXT    NOT NULL,
  erros_json  TEXT    NOT NULL,
  em          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tentativa_licao ON tentativa (licao_id, em DESC);

CREATE TABLE IF NOT EXISTS dica_revelada (
  licao_id TEXT    NOT NULL,
  nivel    INTEGER NOT NULL,
  em       INTEGER NOT NULL,
  PRIMARY KEY (licao_id, nivel)
);

CREATE TABLE IF NOT EXISTS xp_evento (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  licao_id TEXT,
  delta    INTEGER NOT NULL,
  motivo   TEXT    NOT NULL,
  em       INTEGER NOT NULL
);
`

type LinhaProgresso = {
  licao_id: string
  trilha: string
  estado: string
  tentativas: number
  dica_maxima: number
  usou_ia: number
  xp_ganho: number
  sem_ajuda: number
  primeira_em: number | null
  concluida_em: number | null
}

/** Progress Store — SQLite local. Nada sai da máquina. */
export class ArmazemDeProgresso {
  readonly #db: DatabaseSync

  constructor(caminho: string) {
    if (caminho !== ':memory:') {
      fs.mkdirSync(path.dirname(caminho), { recursive: true })
    }
    this.#db = new DatabaseSync(caminho)
    this.#db.exec(ESQUEMA)
    this.#db
      .prepare('INSERT OR IGNORE INTO aluno (id, nome, criado_em) VALUES (1, ?, ?)')
      .run('aluno', Date.now())
    log.debug(`progresso em ${caminho}`)
  }

  fechar(): void {
    try {
      this.#db.close()
    } catch (e) {
      log.debug('falha ao fechar o banco', e)
    }
  }

  // ── leitura ──────────────────────────────────────────────────────────────

  progresso(licaoId: string): ProgressoLicao | null {
    const linha = this.#db
      .prepare('SELECT * FROM licao_progresso WHERE licao_id = ?')
      .get(licaoId) as LinhaProgresso | undefined
    return linha === undefined ? null : converter(linha)
  }

  todosOsProgressos(): ProgressoLicao[] {
    const linhas = this.#db
      .prepare('SELECT * FROM licao_progresso ORDER BY licao_id')
      .all() as unknown as LinhaProgresso[]
    return linhas.map(converter)
  }

  concluidas(): Set<string> {
    const linhas = this.#db
      .prepare("SELECT licao_id FROM licao_progresso WHERE estado = 'concluida'")
      .all() as unknown as { licao_id: string }[]
    return new Set(linhas.map((l) => l.licao_id))
  }

  dicasReveladas(licaoId: string): number[] {
    const linhas = this.#db
      .prepare('SELECT nivel FROM dica_revelada WHERE licao_id = ? ORDER BY nivel')
      .all(licaoId) as unknown as { nivel: number }[]
    return linhas.map((l) => l.nivel)
  }

  resumo(): ResumoProgresso {
    const totalXp = this.#db.prepare('SELECT COALESCE(SUM(delta), 0) AS t FROM xp_evento').get() as
      | { t: number }
      | undefined

    const agregados = this.#db
      .prepare(
        `SELECT trilha,
                SUM(CASE WHEN estado = 'concluida' THEN 1 ELSE 0 END) AS concluidas,
                COALESCE(SUM(xp_ganho), 0) AS xp
           FROM licao_progresso
          GROUP BY trilha
          ORDER BY trilha`,
      )
      .all() as unknown as { trilha: string; concluidas: number; xp: number }[]

    const contagens = this.#db
      .prepare(
        `SELECT
           SUM(CASE WHEN estado = 'concluida' THEN 1 ELSE 0 END) AS concluidas,
           SUM(CASE WHEN estado = 'concluida' AND sem_ajuda = 1 THEN 1 ELSE 0 END) AS sem_ajuda,
           COALESCE(SUM(tentativas), 0) AS tentativas
         FROM licao_progresso`,
      )
      .get() as { concluidas: number | null; sem_ajuda: number | null; tentativas: number } | undefined

    return {
      xpTotal: totalXp?.t ?? 0,
      licoesConcluidas: contagens?.concluidas ?? 0,
      licoesSemAjuda: contagens?.sem_ajuda ?? 0,
      tentativasTotais: contagens?.tentativas ?? 0,
      porTrilha: agregados,
    }
  }

  historicoDeErros(limite = 50): { licaoId: string; erros: unknown; em: number }[] {
    const linhas = this.#db
      .prepare(
        `SELECT licao_id, erros_json, em FROM tentativa
          WHERE aprovada = 0 AND erros_json <> '[]'
          ORDER BY em DESC LIMIT ?`,
      )
      .all(limite) as unknown as { licao_id: string; erros_json: string; em: number }[]

    return linhas.map((l) => ({
      licaoId: l.licao_id,
      erros: seguroJson(l.erros_json),
      em: l.em,
    }))
  }

  // ── escrita ──────────────────────────────────────────────────────────────

  iniciar(licaoId: string, trilha: string): ProgressoLicao {
    const agora = Date.now()
    this.#db
      .prepare(
        `INSERT INTO licao_progresso (licao_id, trilha, estado, primeira_em, atualizada_em)
         VALUES (?, ?, 'em_andamento', ?, ?)
         ON CONFLICT (licao_id) DO UPDATE SET atualizada_em = excluded.atualizada_em`,
      )
      .run(licaoId, trilha, agora, agora)
    return this.progresso(licaoId) as ProgressoLicao
  }

  revelarDica(licaoId: string, trilha: string, nivel: number): ProgressoLicao {
    const agora = Date.now()
    this.iniciar(licaoId, trilha)
    this.#db
      .prepare('INSERT OR IGNORE INTO dica_revelada (licao_id, nivel, em) VALUES (?, ?, ?)')
      .run(licaoId, nivel, agora)
    this.#db
      .prepare(
        `UPDATE licao_progresso
            SET dica_maxima = MAX(dica_maxima, ?), atualizada_em = ?
          WHERE licao_id = ?`,
      )
      .run(nivel, agora, licaoId)
    return this.progresso(licaoId) as ProgressoLicao
  }

  marcarUsoDeIa(licaoId: string, trilha: string): ProgressoLicao {
    this.iniciar(licaoId, trilha)
    this.#db
      .prepare('UPDATE licao_progresso SET usou_ia = 1, atualizada_em = ? WHERE licao_id = ?')
      .run(Date.now(), licaoId)
    return this.progresso(licaoId) as ProgressoLicao
  }

  /**
   * Registra uma tentativa de verificação. Devolve o progresso atualizado e o
   * XP creditado — que é zero em tentativa reprovada e em relição já concluída.
   */
  registrarTentativa(entrada: {
    licaoId: string
    trilha: string
    xpBase: number
    aprovada: boolean
    duracaoMs: number
    checks: unknown
    erros: unknown
  }): { progresso: ProgressoLicao; xpCreditado: number; primeiraConclusao: boolean } {
    const agora = Date.now()
    this.iniciar(entrada.licaoId, entrada.trilha)

    // As quatro escritas abaixo são um fato só. Se uma queda partir a
    // sequência entre o update de xp_ganho e o insert em xp_evento, o XP total
    // (soma de xp_evento) ficaria permanentemente menor que a soma por trilha
    // exibida na UI, sem caminho de correção.
    this.#db.exec('BEGIN IMMEDIATE')
    try {
      const resultado = this.#registrarTentativaNaTransacao(entrada, agora)
      this.#db.exec('COMMIT')
      return resultado
    } catch (e) {
      this.#db.exec('ROLLBACK')
      throw e
    }
  }

  #registrarTentativaNaTransacao(
    entrada: {
      licaoId: string
      trilha: string
      xpBase: number
      aprovada: boolean
      duracaoMs: number
      checks: unknown
      erros: unknown
    },
    agora: number,
  ): { progresso: ProgressoLicao; xpCreditado: number; primeiraConclusao: boolean } {
    this.#db
      .prepare(
        `INSERT INTO tentativa (licao_id, aprovada, duracao_ms, checks_json, erros_json, em)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entrada.licaoId,
        entrada.aprovada ? 1 : 0,
        Math.trunc(entrada.duracaoMs),
        JSON.stringify(entrada.checks ?? []),
        JSON.stringify(entrada.erros ?? []),
        agora,
      )

    this.#db
      .prepare(
        'UPDATE licao_progresso SET tentativas = tentativas + 1, atualizada_em = ? WHERE licao_id = ?',
      )
      .run(agora, entrada.licaoId)

    const atual = this.progresso(entrada.licaoId) as ProgressoLicao

    if (!entrada.aprovada) {
      return { progresso: atual, xpCreditado: 0, primeiraConclusao: false }
    }

    if (atual.estado === 'concluida') {
      // Refazer é ótimo para o aprendizado e não rende XP: a recompensa
      // acompanha competência nova, não repetição.
      return { progresso: atual, xpCreditado: 0, primeiraConclusao: false }
    }

    const xp = xpDaConclusao(entrada.xpBase, atual.dicaMaxima, atual.usouIa)
    const semAjuda = resolvidaSemAjuda(atual.dicaMaxima, atual.usouIa)

    this.#db
      .prepare(
        `UPDATE licao_progresso
            SET estado = 'concluida', xp_ganho = ?, sem_ajuda = ?,
                concluida_em = ?, atualizada_em = ?
          WHERE licao_id = ?`,
      )
      .run(xp, semAjuda ? 1 : 0, agora, agora, entrada.licaoId)

    this.#db
      .prepare('INSERT INTO xp_evento (licao_id, delta, motivo, em) VALUES (?, ?, ?, ?)')
      .run(entrada.licaoId, xp, semAjuda ? 'conclusao_sem_ajuda' : 'conclusao', agora)

    return {
      progresso: this.progresso(entrada.licaoId) as ProgressoLicao,
      xpCreditado: xp,
      primeiraConclusao: true,
    }
  }

  /** Só para testes e para o comando de reset de progresso. */
  limparTudo(): void {
    this.#db.exec(
      'DELETE FROM licao_progresso; DELETE FROM tentativa; DELETE FROM dica_revelada; DELETE FROM xp_evento;',
    )
  }
}

function converter(linha: LinhaProgresso): ProgressoLicao {
  return {
    licaoId: linha.licao_id,
    trilha: linha.trilha,
    estado: linha.estado as EstadoLicao,
    tentativas: linha.tentativas,
    dicaMaxima: linha.dica_maxima,
    usouIa: linha.usou_ia === 1,
    xpGanho: linha.xp_ganho,
    semAjuda: linha.sem_ajuda === 1,
    primeiraEm: linha.primeira_em,
    concluidaEm: linha.concluida_em,
  }
}

function seguroJson(texto: string): unknown {
  try {
    return JSON.parse(texto)
  } catch {
    return []
  }
}
