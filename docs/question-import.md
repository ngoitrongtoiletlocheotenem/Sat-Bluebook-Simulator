# Question import and export

From **Question library → Import**, upload CSV, XLSX or JSON, select a private/shared destination, optionally map nonstandard headers, parse, review errors/duplicates, then explicitly confirm valid questions. Parsing does not write questions. A stored report shows imported/skipped/failed rows. Invalid questions cannot silently enter the bank. Downloads provide a template for each format.

## Manual fallback for missing images and graphs

Start with **Question library → Import → Parse & preview**. The importer reads the supplied question content and image references first. No separate image-preparation step is required.

If a figure is missing, unreadable, or linked to a local file that cannot be found:

1. Find the affected question in the preview and click **Repair images**. For a figure the parser did not detect at all, click **Attach images manually** on that question's row.
2. Remove the broken reference, then upload the original PNG, JPEG, or WebP image. Files must be at most 5 MB each; each question supports up to 10 images. Preview the uploaded figure to check that it belongs to the question.
3. Click **Save images**. The attachment is saved directly into that import row and the row is revalidated. Other fields, validation errors, duplicate decisions, and the selected private/shared destination are preserved. The spreadsheet does not need to be edited or reuploaded.
4. Resolve any remaining errors, then click **Confirm valid questions**. No question is written to the bank until confirmation. **Cancel image changes** leaves that row's attachments unchanged.

Text-only questions require no image action. When an existing image needs a manual adjustment, use **Edit images** on its row. Missing local image files and unsupported references are flagged during validation. HTTPS links are not fetched by the server; failed image previews in the browser also offer the repair control.

If the whole question file cannot be parsed, **Enter question manually** opens the question editor. Its **Images and charts** upload control attaches figures directly to that manually entered question. The same editor is available through **Question library → Add question**.

Excel pictures/drawings pasted over cells are not read by the current importer. Use the row's manual attachment control when a figure is not detected. Base64 `data:` strings, paths such as `C:\Pictures\graph.png`, and a filename alone are not supported image references; users can repair them directly in the preview.

For files that already provide supported image references, an `images` cell can contain a single `/uploads/` or HTTPS link, or a JSON array for several images:

```json
["/uploads/<first-generated-id>.png", "/uploads/<second-generated-id>.webp"]
```

Comma- or semicolon-separated links are also accepted; JSON imports can use an array directly. Existing working links continue to import without manual attachment.

Uploaded image URLs can be opened by anyone with the link. Private question ownership does not restrict image URL access. For administrators, uploaded bytes remain in `UPLOAD_DIR` (default `data/uploads`) and upload metadata is stored in `question_assets`. Back up both the database and upload directory. Cancelling an attachment edit does not delete files already uploaded to the server.

## Question files and validation

The backend accepts at most 5 MB per file. CSV uses `csv-parse`, XLSX uses ExcelJS, JSON is an array of question records. Column mapping is JSON from canonical field to incoming header, for example `{"stem":"Question Text","correctAnswer":"Answer"}`. The downloadable templates are the authoritative examples for exact columns and complex field encodings.

Required content includes a stable public identifier, section (`rw`/`math`), matching domain/skill identifiers, type (`mcq`/`spr`), difficulty (`easy`/`medium`/`hard`), stem, correct answer/accepted numeric values, and provenance. MCQ questions require unique A–D-style choice identifiers and a valid correct identifier. SPR is limited to Math and requires parseable numeric values. The question editor generates a new identifier when one is not entered.

Optional fields include passage, full explanation, choice rationales, hint, strategy, tags, images, subskill, numeric difficulty, calculator metadata and source URL. Safe HTML supports paragraphs/emphasis/lists/tables. Inline math uses `$...$`; display math uses `$$...$$`. Content is sanitized at ingestion and again before rendering. JavaScript, event-handler markup, unsafe URL schemes and embedded executable content are discarded/rejected.

Students import only into their own private bank. Teachers/admins can author shared content. Every mutation and import confirmation checks permissions on the server. A student cannot promote private content into the shared bank by changing a request. No scraper, copyrighted question download or proprietary question corpus is included.

JSON export is available for authorized visible content, with student export limited to their private collection. Export backs up content rather than sessions/student records. Re-import identifies duplicate public identifiers; intentionally edit/version an existing record through the editor instead of importing over it. Complete disaster recovery uses a database plus upload backup.
