# MTH Blog Editor

Editor local para posts Markdown e fotos de um blog Astro.

## Compilar

Instale Bun, Go 1.25 ou posterior e as dependências nativas da WebView:

- **Windows:** GCC/G++ e `windres` compatíveis com MinGW-w64, com suporte a C++14, no PATH. O `windres` incorpora o ícone ao executável. Para executar, é necessário o runtime Microsoft Edge WebView2 (normalmente já instalado no Windows 11).
- **Linux:** GTK 3, WebKitGTK 4.0, `pkg-config` e compilador C/C++. No Ubuntu 22.04: `sudo apt install build-essential pkg-config libgtk-3-dev libwebkit2gtk-4.0-dev`. O binding Go utilizado exige `webkit2gtk-4.0`; distribuições que oferecem apenas 4.1 precisam de uma adaptação do binding antes de compilar. Para abrir links externos, é necessário `xdg-open` (`xdg-utils`).

```sh
bun run build
```

O build detecta o sistema atual: gera `MTH-Editor.exe` no Windows ou `MTH-Editor` no Linux. Para mudar o nome, edite a variável `executableName` em `build.ts`, sem incluir a extensão. A saída fica na raiz do projeto.

Abra `MTH-Editor.exe` no Windows ou execute `./MTH-Editor` no Linux. O editor abre em uma janela nativa, sem abas ou barra de endereço. HTML, CSS, JavaScript e o servidor Bun ficam embutidos no executável; o motor de navegação é fornecido pelo sistema. Bun, Go e os compiladores são necessários apenas na máquina de build.

A janela inicia o servidor local em `127.0.0.1`, detecta a porta disponível e encerra o servidor ao fechar. Se houver alterações não salvas, o editor pede confirmação. A seleção de pastas usa um diálogo nativo nos dois sistemas; links do mapa e do blog abrem no navegador externo. O servidor é extraído para uma pasta temporária privada durante a execução e removido ao encerrar normalmente.

O build é feito no sistema de destino. O executável Linux depende das bibliotecas GTK/WebKitGTK instaladas na máquina; não é um binário totalmente estático. O código Linux precisa ser validado em uma máquina Linux com ambiente gráfico.

## Miniaturas e ícone

A lista de fotos carrega miniaturas JPEG de até 112 pixels no maior lado, geradas sob demanda. O cache fica na pasta temporária do sistema, separado dos arquivos do blog, e é renovado quando a imagem original muda. Entradas com mais de sete dias são removidas periodicamente. A geração é limitada a duas imagens por vez; fotos fora da área visível são carregadas apenas ao rolar a lista. A prévia de edição continua usando a imagem completa.

O processamento de JPG, PNG, GIF, WebP e AVIF fica embutido no aplicativo, sem exigir um programa externo de conversão. Em desenvolvimento com `bun start`, o servidor usa `go run ./thumbnail` para a conversão. As miniaturas não preservam metadados EXIF e respeitam a orientação de fotos JPEG.

O ícone de máquina de escrever segue o estilo pixel art do Windows 95. O arquivo `assets/app-icon.ico` contém os tamanhos 16, 24, 32, 48, 64, 128 e 256 pixels; `launcher/app-icon.png` é usado no Linux. A imagem de origem e as instruções de geração estão em `assets/ICON.md`.

Para verificar os testes do launcher e gerar o executável:

```sh
bun run build --check
```

Ao importar uma foto, marque **Publicar localização exata** para incluir o lugar. Se a imagem não tiver GPS, preencha o nome, a latitude e a longitude em graus decimais (com vírgula ou ponto). Se tiver, as coordenadas são preenchidas automaticamente e podem ser ajustadas. Use **Ver no mapa** para conferir antes de salvar. A localização é gravada no Markdown da foto.

Em **Fotos** (`/photos` ou `/img`), selecione a pasta `src/content/img` do blog para listar os posts de fotos existentes. Busque por título, tag ou lugar e clique em uma foto para editar título, data, texto alternativo, legenda, tags e localização. **Salvar foto** atualiza o mesmo Markdown, preservando o nome do arquivo, a imagem e os demais dados do post. Desmarque **Publicar localização** para removê-la; ao editar, também é possível manter somente o nome do lugar, com as duas coordenadas vazias. Use **Nova foto** para importar outra imagem.

Se um arquivo mudar fora do editor, o salvamento será bloqueado para evitar sobrescrever a alteração. Clique novamente na foto para reabrir os dados do disco. Arquivos Markdown inválidos são indicados na lista sem impedir o acesso às outras fotos.

## Desenvolvimento

```sh
bun start
bun test
```
