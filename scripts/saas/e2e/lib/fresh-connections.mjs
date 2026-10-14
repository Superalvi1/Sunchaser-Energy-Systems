// Imported FIRST by journeys that run psql synchronously between requests. A synchronous child process blocks this program's event loop for seconds; a
// pooled keep-alive connection that the server closed in the meantime is then reused and the request fails with "other side closed" (UND_ERR_SOCKET) before
// it was ever processed. That is a property of the test script, not of the application, so a journey never reuses a connection.
const real = globalThis.fetch;
globalThis.fetch = (input, init = {}) => {
  const headers = new Headers(init.headers || (typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined));
  headers.set("connection", "close");
  return real(input, { ...init, headers });
};
