# MTH Blog Editor

Editor local para posts Markdown e fotos de um blog Astro.

## Compilar

No Windows, com Bun e Go instalados:

```sh
bun run build
```

Abra `MTH-Editor.exe` e escolha a pasta dos posts ou das fotos. O editor abre no navegador e salva diretamente nos arquivos.

Ao importar uma foto, marque **Publicar localização exata** para incluir o lugar. Se a imagem não tiver GPS, preencha o nome, a latitude e a longitude em graus decimais (com vírgula ou ponto). Se tiver, as coordenadas são preenchidas automaticamente e podem ser ajustadas. Use **Ver no mapa** para conferir antes de salvar. A localização é gravada no Markdown da foto.

## Desenvolvimento

```sh
bun start
bun test
```
