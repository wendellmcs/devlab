import Docker from 'dockerode'

let instancia: Docker | null = null

/**
 * Cliente Docker do agente.
 *
 * Sem opções explícitas, o dockerode respeita DOCKER_HOST e cai no socket
 * padrão /var/run/docker.sock — que é o caminho no WSL2, tanto com Docker
 * Engine nativo quanto com Docker Desktop usando o backend WSL2.
 */
export function docker(): Docker {
  instancia ??= new Docker()
  return instancia
}

export type DiagnosticoDaemon =
  | { ok: true; versao: string; apiVersao: string; sistema: string }
  | { ok: false; erro: string; sugestao: string }

export async function diagnosticarDaemon(): Promise<DiagnosticoDaemon> {
  try {
    const info = await docker().version()
    return {
      ok: true,
      versao: String(info.Version ?? '?'),
      apiVersao: String(info.ApiVersion ?? '?'),
      sistema: `${String(info.Os ?? '?')}/${String(info.Arch ?? '?')}`,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, erro: msg, sugestao: sugerirCorrecao(msg) }
  }
}

function sugerirCorrecao(mensagem: string): string {
  if (/ENOENT/.test(mensagem)) {
    return (
      'O socket /var/run/docker.sock não existe. Instale o Docker Engine dentro do WSL2 ' +
      '(https://docs.docker.com/engine/install/ubuntu/) ou, se usa Docker Desktop, ' +
      'habilite a integração com esta distro em Settings → Resources → WSL Integration.'
    )
  }
  if (/EACCES|permission denied/i.test(mensagem)) {
    return (
      'Sem permissão no socket do Docker. Rode: sudo usermod -aG docker "$USER" ' +
      'e abra um novo shell (ou `newgrp docker`).'
    )
  }
  if (/ECONNREFUSED/.test(mensagem)) {
    return 'O socket existe mas o daemon não responde. Rode: sudo service docker start'
  }
  return 'Verifique se o daemon do Docker está rodando: docker info'
}

/** Erro de infraestrutura do lab, com mensagem já pronta para o aluno. */
export class ErroDeLab extends Error {
  readonly codigo: string
  readonly detalhe: string | undefined

  constructor(codigo: string, mensagem: string, detalhe?: string) {
    super(mensagem)
    this.name = 'ErroDeLab'
    this.codigo = codigo
    this.detalhe = detalhe
  }
}
