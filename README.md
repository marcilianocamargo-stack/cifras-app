# Cifras

App de cifras para quem toca em missa, acampamento e encontro de igreja.
Você carrega os PDFs dos seus cantos uma vez e eles ficam no celular — organizados
em pastas por celebração, em ordem alfabética quando você quiser, e funcionando
**sem internet**.

É um PWA: abre no navegador do Android e pode ser instalado na tela inicial como
um app normal, com ícone próprio e tela cheia.

## O que ele faz

- **Carregar cantos** — botão *Carregar*, você escolhe vários PDFs (ou fotos das cifras)
  de uma vez. Os arquivos são copiados para dentro do app.
- **Pastas por celebração** — *Missa de domingo*, *Acampamento*, *Adoração*.
  Um mesmo canto pode estar em várias pastas sem ser duplicado.
- **Ordem alfabética** — A→Z, Z→A ou mais recentes na biblioteca; dentro da pasta você
  ainda tem a *ordem da celebração*: segura na alça (⋮⋮) de um canto e arrasta pra
  posição que quiser — 1º, 2º, 3º... A lista rola sozinha se você arrastar até a borda
  da tela. Quem preferir sem arrastar, tem as mesmas opções (mover pra cima/baixo/topo/
  final) no menu ⋮ de cada canto.
- **Busca instantânea** por nome do canto.
- **Leitura pensada para tocar**: rolagem contínua, zoom, tela que não apaga enquanto
  você lê, e ► ◄ para pular direto ao próximo canto da pasta sem sair da tela.
- **Modo noturno da página** (☽) — inverte as cores do PDF para ler no escuro.
- **Funciona offline**, sempre. Nada é enviado para lugar nenhum: seus PDFs ficam
  guardados só no seu aparelho.

## Instalar no celular

1. Abra o endereço do app no **Chrome do Android**.
2. Menu ⋮ → **Instalar app** (ou *Adicionar à tela inicial*).
3. Abra pelo ícone. A partir daí funciona sem internet.

O app está publicado em:
**https://marcilianocamargo-stack.github.io/cifras-app/**

> O app precisa de um endereço `https://` (ou `localhost`) para ser instalável —
> é uma exigência dos navegadores para PWAs.

## Como uso no dia a dia

1. **Carregar** → escolho todos os PDFs dos cantos → *Nova pasta* → "Missa de Domingo".
2. Dentro da pasta, deixo em **Ordem da celebração** e arrasto pela alça (⋮⋮) pra
   pôr na sequência: entrada, ato penitencial, aclamação, ofertório, comunhão, final.
3. Na hora de tocar, abro o primeiro canto e vou passando com ►.
4. Para achar um canto solto, uso a aba **Músicas** em A→Z ou a busca.

Um teclado ou **pedal Bluetooth de virar página** também funciona: as teclas
`PageDown`/`PageUp` e as setas rolam a página e, no fim dela, pulam para o próximo canto.

## Onde ficam os arquivos

Tudo é guardado no armazenamento do próprio navegador (IndexedDB), no seu aparelho.
O app pede ao Android para marcar esse espaço como **permanente**, para o sistema não
apagar os cantos quando estiver com pouca memória.

Ainda assim, vale guardar os PDFs originais em algum lugar (Drive, computador):
se você desinstalar o app ou limpar os dados do navegador, a biblioteca vai junto.

## Rodar no computador

```bash
node tools/dev-server.mjs
```

Abre em `http://localhost:5173`. Não precisa instalar nada — o servidor é um
arquivo só, sem dependências.

Para gerar os ícones de novo depois de mexer no desenho:

```bash
node tools/make-icons.mjs
```

## Como está feito

HTML, CSS e JavaScript puro, sem framework e sem build.

| Arquivo | Para que serve |
| --- | --- |
| `index.html` | as telas |
| `styles.css` | aparência, tema claro/escuro |
| `js/app.js` | navegação, listas, pastas, importação |
| `js/db.js` | banco local (IndexedDB) |
| `js/viewer.js` | desenho das páginas do PDF |
| `sw.js` | funcionamento offline |
| `vendor/` | [pdf.js](https://mozilla.github.io/pdf.js/) da Mozilla, embutido para não depender de internet |

## Licença

MIT — veja [LICENSE](LICENSE).
O pdf.js é da Mozilla, sob licença Apache 2.0 (`vendor/LICENSE_pdfjs.txt`).
