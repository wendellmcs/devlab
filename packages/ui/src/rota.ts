import { useCallback, useEffect, useState } from 'react'

/**
 * Roteamento por URL, em ~60 linhas e sem dependência.
 *
 * Existe porque o app tinha estado de navegação só na memória do React: não
 * havia endereço para uma lição, o botão voltar do navegador saía do DevLab, e
 * recarregar a página jogava o aluno de volta ao começo. Isso também é WCAG
 * 2.4.8 (Localização, AAA) — o endereço é parte de saber onde se está.
 *
 * Não entra react-router: o projeto tem "sem dependência nativa, bundle
 * offline" como princípio, e são quatro rotas. O servidor de estáticos já faz
 * fallback de SPA para qualquer caminho, então History API funciona direto.
 */

export type Rota =
  | { tela: 'mapa' }
  | { tela: 'trilha'; trilhaId: string }
  | { tela: 'licao'; licaoId: string }
  | { tela: 'aluno' }

const MAPA: Rota = { tela: 'mapa' }

/** `/trilha/linux` → `{ tela: 'trilha', trilhaId: 'linux' }` */
export function analisarCaminho(caminho: string): Rota {
  const partes = caminho.replace(/^\/+|\/+$/g, '').split('/')
  const [raiz, arg] = partes

  if (raiz === '' || raiz === undefined) return MAPA
  if (raiz === 'aluno') return { tela: 'aluno' }
  if (raiz === 'trilha' && arg !== undefined && arg !== '') {
    return { tela: 'trilha', trilhaId: decodeURIComponent(arg) }
  }
  if (raiz === 'licao' && arg !== undefined && arg !== '') {
    return { tela: 'licao', licaoId: decodeURIComponent(arg) }
  }
  // Caminho desconhecido cai no mapa em vez de tela em branco.
  return MAPA
}

export function paraCaminho(r: Rota): string {
  switch (r.tela) {
    case 'mapa':
      return '/'
    case 'aluno':
      return '/aluno'
    case 'trilha':
      return `/trilha/${encodeURIComponent(r.trilhaId)}`
    case 'licao':
      return `/licao/${encodeURIComponent(r.licaoId)}`
  }
}

export type Navegar = (r: Rota, opcoes?: { substituir?: boolean }) => void

/**
 * Rota atual + função de navegação.
 *
 * `popstate` cobre o botão voltar/avançar do navegador; `pushState` não o
 * dispara, então o estado é atualizado à mão ao navegar.
 */
export function useRota(): [Rota, Navegar] {
  const [rota, setRota] = useState<Rota>(() => analisarCaminho(window.location.pathname))

  useEffect(() => {
    const aoVoltar = (): void => setRota(analisarCaminho(window.location.pathname))
    window.addEventListener('popstate', aoVoltar)
    return () => window.removeEventListener('popstate', aoVoltar)
  }, [])

  const navegar = useCallback<Navegar>((destino, opcoes) => {
    const caminho = paraCaminho(destino)
    if (caminho === window.location.pathname) return
    if (opcoes?.substituir === true) window.history.replaceState(null, '', caminho)
    else window.history.pushState(null, '', caminho)
    setRota(destino)
  }, [])

  return [rota, navegar]
}

/**
 * Props de um link que navega sem recarregar a página.
 *
 * Continua sendo um `<a href>` de verdade: abre em nova aba com Ctrl+clique,
 * aparece na barra de status, e o leitor de tela o anuncia como link — coisas
 * que um `<div onClick>` perde. O `preventDefault` só intercepta o clique
 * simples, sem modificador.
 */
export function propsDeLink(
  destino: Rota,
  navegar: Navegar,
): { href: string; onClick: (e: React.MouseEvent) => void } {
  return {
    href: paraCaminho(destino),
    onClick: (e) => {
      if (e.defaultPrevented || e.button !== 0) return
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      e.preventDefault()
      navegar(destino)
    },
  }
}
