Place your TLS certificate files in this directory before starting the production stack.

Expected filenames:

- `fullchain.pem`
- `privkey.pem`

Example layout:

```text
infra/nginx/certs/fullchain.pem
infra/nginx/certs/privkey.pem
```

These files are intentionally ignored by git.
