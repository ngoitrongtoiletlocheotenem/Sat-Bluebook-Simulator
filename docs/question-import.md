# Question import and export

From **Question library → Import**, upload CSV, XLSX or JSON, select a private/shared destination, optionally map nonstandard headers, parse, review errors/duplicates, then explicitly confirm valid questions. Parsing does not write questions. A stored report shows imported/skipped/failed rows. Invalid questions cannot silently enter the bank. Downloads provide a template for each format.

The backend accepts at most 5 MB per file. CSV uses `csv-parse`, XLSX uses ExcelJS, JSON is an array of question records. Column mapping is JSON from canonical field to incoming header, for example `{"stem":"Question Text","correctAnswer":"Answer"}`. The downloadable templates are the authoritative examples for exact columns and complex field encodings.

Required content includes a stable public identifier, section (`rw`/`math`), matching domain/skill identifiers, type (`mcq`/`spr`), difficulty (`easy`/`medium`/`hard`), stem, correct answer/accepted numeric values, and provenance. MCQ questions require unique A–D-style choice identifiers and a valid correct identifier. SPR is limited to Math and requires parseable numeric values. The question editor generates a new identifier when one is not entered.

Optional fields include passage, full explanation, choice rationales, hint, strategy, tags, images, subskill, numeric difficulty, calculator metadata and source URL. Safe HTML supports paragraphs/emphasis/lists/tables. Inline math uses `$...$`; display math uses `$$...$$`. Content is sanitized at ingestion and again before rendering. JavaScript, event-handler markup, unsafe URL schemes and embedded executable content are discarded/rejected.

Students import only into their own private bank. Teachers/admins can author shared content. Every mutation and import confirmation checks permissions on the server. A student cannot promote private content into the shared bank by changing a request. No scraper, copyrighted question download or proprietary question corpus is included.

JSON export is available for authorized visible content, with student export limited to their private collection. Export backs up content rather than sessions/student records. Re-import identifies duplicate public identifiers; intentionally edit/version an existing record through the editor instead of importing over it. Complete disaster recovery uses a database plus upload backup.
