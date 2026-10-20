---
sidebar_position: 1
id: file-uploads
title: File Uploads & Storage
description: Multipart file uploads, MIME type validation, and protected file serving
---

File Uploads & Storage

NodeStack handles binary attachments with integrated disk storage, MIME detection, and token-protected access.

---

## File Upload Endpoint

Files are uploaded directly alongside standard JSON record fields via `multipart/form-data`:

```bash
curl -X POST http://localhost:8090/api/collections/documents/records \
  -H "Authorization: Bearer <TOKEN>" \
  -F "title=Q3 Financial Report" \
  -F "attachment=@/path/to/report.pdf"
```

The server:
1. Validates the file extension and detected magic-number MIME type against schema constraints.
2. Generates an obfuscated unique filename on disk inside `./nodestack_data/storage/`.
3. Stores the filename string in the record's `attachment` field.

---

## Accessing Files

Files are served via the file endpoint:

```
GET /api/files/:collection/:recordId/:filename
```

### Example URL
```
http://localhost:8090/api/files/documents/rec_98765/report_x8192a.pdf
```

---

## Protected File Access

If a collection's View Rule restricts access to authenticated users or owners, file downloads require authentication:

### 1. Authorization Header
Pass standard `Authorization: Bearer <TOKEN>` header.

### 2. URL Token Parameter
For browser `<img>`, `<video>`, or `<a>` download links where custom headers cannot be set:

```
http://localhost:8090/api/files/documents/rec_98765/report.pdf?token=<TOKEN>
```

---

## Using via `nodestack-client`

Generating authenticated file URLs with the client SDK:

```typescript
const record = await client.collection('documents').getOne('rec_98765');

// Get direct URL with token automatically appended if needed
const fileUrl = client.getFileUrl(record, record.attachment);
console.log('Download URL:', fileUrl);
```
