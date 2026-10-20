# Ícone do editor

Máquina de escrever em pixel art, com inspiração nos ícones de aplicativos criativos dos anos 90 e no Windows 95. O desenho usa fundo transparente, papel marfim, corpo cinza e detalhes em terracota, sem letras ou marcas.

Gerado com a ferramenta integrada ImageGen. A versão final está em `app-icon-retro-source.png`. O primeiro estudo, anterior à direção retrô, foi preservado em `app-icon-source.png`.

## Prompt final

Use case: logo-brand. Asset type: authentic 1990s Windows 95 desktop application icon. Primary request: a vintage mechanical typewriter as a pixel-art application icon, inspired by the visual language of classic mid-1990s Adobe creative-software desktop icons, without copying any existing logo or adding brand letters. A single compact 3/4 isometric typewriter with a sheet of paper, dark charcoal/steel grey body, ivory paper, small muted terracotta accent on the carriage or ribbon. Authentic Windows 95 / Windows NT 4 application icon aesthetic: deliberately coarse pixel clusters corresponding to a native 32 by 32 pixel design, hard stepped pixel edges, black and dark-grey 1-pixel outlines at native resolution, silver grey beveled highlights, 16-color indexed-palette look, subtle dithered shading, clean recognizable silhouette, no anti-aliased or painterly details. Draw it as a 32x32 icon enlarged with nearest-neighbor to fill a square image, not as a screenshot or mockup. The icon should be centered with minimal transparent padding. Genuinely transparent background. One icon only. No text, no letters, no Adobe wordmark, no background tile, no UI frame, no realistic lighting, no smooth gradients, no rounded modern app badge.

## Arquivos de uso

- `app-icon.ico`: recurso Windows com sete tamanhos.
- `app-icon-32.png`: prévia em tamanho pequeno.
- `../launcher/app-icon.png`: imagem PNG de 256 pixels para a janela Linux.

Para reconverter a imagem de origem, execute `node assets/prepare-icon.cjs` com o pacote `sharp` disponível. Essa ferramenta serve apenas para preparar os assets; não é necessária no build normal, que utiliza os arquivos já convertidos.
