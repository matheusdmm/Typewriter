# Typewriter

Editor local para posts Markdown e fotos de um blog Astro.

## Usar

Baixe o pacote x64 nas [Releases](https://github.com/matheusdmm/Typewriter/releases):

- **Windows:** extraia o ZIP e abra `Typewriter.exe`. Requer Microsoft Edge WebView2.
- **Linux:** extraia o TAR.GZ e execute `./Typewriter`. Requer GTK 3, WebKitGTK 4.0 e `xdg-utils`.

No Ubuntu 22.04, instale as dependências de execução:

```sh
sudo apt install libgtk-3-0 libwebkit2gtk-4.0-37 xdg-utils
```

Distribuições com apenas WebKitGTK 4.1 não são compatíveis com o pacote Linux atual.

No editor, clique em **Escolher pasta** para abrir seus posts. Em **Fotos**, selecione a pasta `src/content/img` do blog para importar ou editar fotos.

## Desenvolver e compilar

Instale Bun, Go 1.25+ e as ferramentas do seu sistema:

- **Windows:** MinGW-w64 com GCC/G++ e `windres` no PATH.
- **Linux (Ubuntu 22.04):** `sudo apt install build-essential pkg-config libgtk-3-dev libwebkit2gtk-4.0-dev xdg-utils`.

```sh
bun start              # Desenvolvimento
bun test               # Testes
bun run build --check  # Testes do launcher e compilação
```

Compile no sistema de destino. O executável será gerado na raiz: `Typewriter.exe` no Windows ou `Typewriter` no Linux. Bun e Go são necessários apenas para desenvolvimento e compilação.

## Gerar uma versão

O [GitHub Actions](.github/workflows/build.yml) testa e compila para Windows e Linux x64 em pushes na `main`, pull requests e execução manual. Os pacotes ficam em **Artifacts**.

Após enviar as alterações, crie e envie uma tag com a versão desejada:

```sh
git tag -a v1.0.0 -m "Typewriter v1.0.0"
git push origin v1.0.0
```

A tag dispara os builds e cria um rascunho em **Releases**, com os pacotes e checksums SHA-256. Revise e clique em **Publish release**.
