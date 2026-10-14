# Sources of the PDF guides

The five PDFs are built from the HTML in this folder:

| Source | PDF |
|---|---|
| `user-guide.html` | `docs/guides/WearWise-User-Guide.pdf` |
| `setup-guide.html` | `docs/guides/WearWise-Setup-Guide.pdf` |
| `admin-guide.html` | `docs/guides/WearWise-Adding-a-Researcher.pdf` |
| `security-doc.html` | `docs/security/WearWise-Security-Documentation.pdf` (author: Zakiul Atheef) |
| `handover.html` | `docs/guides/WearWise-Handover-Documentation.pdf` |

`guide.css` is the shared style (white A4 pages, Poppins from
`apps/dashboard/src/assets/fonts/`). Screenshots are in `img/`; the logo and the
architecture and pin diagrams are used from where they live in the repository.
`admin-guide.html` quotes `supabase/admin/create-viewer.sql` live through
`<!--INCLUDE-ESCAPED:…-->`, so its appendix always matches the script.

## Rebuilding

Needs Google Chrome (or Chromium) and Python 3 with `pypdf` and `reportlab`
(`pip install pypdf reportlab`). From this folder:

```bash
python3 build.py user-guide.html ../WearWise-User-Guide.pdf
python3 build.py setup-guide.html ../WearWise-Setup-Guide.pdf
python3 build.py admin-guide.html ../WearWise-Adding-a-Researcher.pdf
python3 build.py security-doc.html ../../security/WearWise-Security-Documentation.pdf
python3 build.py handover.html ../WearWise-Handover-Documentation.pdf
```

`build.py` prints Chrome to PDF twice: the first pass finds the page of every
`<h3 id="…">` section, the second fills in the contents page. It then adds the page
footers and the PDF metadata (title from `data-doc`, author from `data-author`, default
"WearWise Project Team"). Set `CHROME=/path/to/chrome` on Windows or Linux.

To check the layout, `python3 pages.py <file.pdf> <prefix>` (needs `pypdfium2` and
`Pillow`) writes contact sheets of the pages.

## Screenshots

All screenshots use synthetic demo data from the local stack (`supabase/seed.sql`) or
made-up accounts (`@example.invalid`). The one-time password in
`img/admin/a3-result.jpg` is masked. When the app or dashboard changes, retake the
affected screenshots the same way (light theme) and rebuild.
