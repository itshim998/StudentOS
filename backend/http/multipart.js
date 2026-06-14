function parseHeaders(rawHeaders) {
  const headers = {};
  for (const line of rawHeaders.split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    headers[line.slice(0, separator).trim().toLowerCase()] = line.slice(separator + 1).trim();
  }
  return headers;
}

function parseContentDisposition(value) {
  const result = {};
  for (const part of String(value || "").split(";")) {
    const [key, raw] = part.trim().split("=");
    if (!key || raw === undefined) continue;
    result[key] = raw.replace(/^"|"$/g, "");
  }
  return result;
}

export async function readMultipartForm(req, { maxBytes = 16 * 1024 * 1024 } = {}) {
  const contentType = req.headers["content-type"] || "";
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!boundaryMatch) {
    const error = new Error("Expected multipart/form-data");
    error.status = 400;
    throw error;
  }
  const boundary = boundaryMatch[1] || boundaryMatch[2];
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
      const error = new Error("Upload body too large");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks);
  const delimiter = Buffer.from(`--${boundary}`);
  const fields = {};
  const files = {};
  let position = 0;

  while (position < body.length) {
    const start = body.indexOf(delimiter, position);
    if (start === -1) break;
    const next = body.indexOf(delimiter, start + delimiter.length);
    if (next === -1) break;
    let part = body.subarray(start + delimiter.length, next);
    if (part.subarray(0, 2).toString() === "--") break;
    if (part.subarray(0, 2).toString() === "\r\n") part = part.subarray(2);
    if (part.subarray(part.length - 2).toString() === "\r\n") part = part.subarray(0, part.length - 2);
    const headerEnd = part.indexOf(Buffer.from("\r\n\r\n"));
    if (headerEnd > 0) {
      const headers = parseHeaders(part.subarray(0, headerEnd).toString("utf8"));
      const content = part.subarray(headerEnd + 4);
      const disposition = parseContentDisposition(headers["content-disposition"]);
      if (disposition.name) {
        if (disposition.filename !== undefined) {
          files[disposition.name] = {
            filename: disposition.filename,
            mimeType: headers["content-type"] || "application/octet-stream",
            bytes: content,
          };
        } else {
          fields[disposition.name] = content.toString("utf8");
        }
      }
    }
    position = next;
  }

  return { fields, files };
}
