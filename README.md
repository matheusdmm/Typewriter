# MTH Blog Editor

Editor local de desktop para posts Markdown e fotos de um blog feito com Astro. Ele grava diretamente nos arquivos do projeto; não exige conta nem serviço externo.

## Começar

O repositório contém o código-fonte. Para gerar o aplicativo no Windows, instale [Bun](https://bun.sh/) e Go e execute nesta pasta:

```powershell
bun run build
```

Depois, abra `MTH-Editor.exe`. Ele inicia o servidor local e abre o editor no navegador. O executável gerado roda sem Bun ou Go instalados. O editor usa a porta `4177` por padrão e escolhe outra porta livre se ela estiver ocupada.

Na primeira execução, escolha a pasta que contém os posts `.md`. Para fotos, abra **Fotos** e escolha a pasta da galeria. Os caminhos ficam salvos em `editor-settings.json` somente no seu computador; esse arquivo é ignorado pelo Git.

Se o editor estiver dentro do repositório do blog ou ao lado de uma pasta `MTH-Blog`, ele procura automaticamente `src/content/blog` e `src/content/img`. Também é possível indicar a raiz do blog pela variável de ambiente `MTH_BLOG_DIR`.

## Escrever e importar

- **Posts:** crie ou abra um arquivo, edite os dados e o corpo, depois salve com o botão ou `Ctrl+S`. O botão de salvar fica ativo quando há alterações. `Ctrl+K` leva à busca de posts.
- **Visual / Markdown:** o modo Visual cobre formatação simples. Posts com tabelas, listas aninhadas, HTML ou outras estruturas avançadas abrem em Markdown para preservar o conteúdo.
- **Imagens no post:** use **Imagem** na barra do editor para inserir na posição do cursor. Informe uma URL `https://...`, uma rota da pasta `public` como `/images/foto.jpg`, ou um caminho relativo ao post como `./foto.jpg` ou `../img/foto.webp`. O texto alternativo é obrigatório. Imagens locais são verificadas antes da inserção e aparecem no modo Visual.
- **Fotos:** escolha JPG, PNG ou WebP, preencha os dados e salve na galeria. A localização exata só entra no post com autorização explícita na tela.
- **Prévia no blog:** o link **Abrir no blog** usa `http://localhost:4321`, quando o editor encontra a estrutura esperada do projeto e o post está publicado. Inicie o servidor Astro separadamente para usá-lo.

O editor avisa sobre alterações não salvas ao trocar de post ou sair da página. Caso um arquivo seja modificado por outro programa, o salvamento é recusado para evitar sobrescrever a versão mais recente.

## Desenvolvimento

Para verificar o código-fonte durante o desenvolvimento:

```powershell
bun test
bun run server.ts --self-test
```

`bun run build` compila o servidor com Bun e gera o lançador de Windows com Go. `MTH-Editor.exe` é a entrada do aplicativo, mas é um artefato gerado e fica fora do Git, assim como `launcher/MTH-Editor-Server.exe`, usado apenas durante o build. O seletor gráfico de pastas e o lançador são específicos do Windows.

## Publicar o código

Antes de criar o repositório no GitHub, revise o histórico e escolha uma licença se quiser permitir reutilização por outras pessoas. Publique o código-fonte e as instruções de compilação; quem clonar o projeto gera `MTH-Editor.exe` com `bun run build`. Não inclua `editor-settings.json`, posts ou fotos pessoais. O `.gitignore` exclui os arquivos locais e os executáveis gerados.
