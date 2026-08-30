# LifeOS Marketplace · P2 safety model

P2 introduces a registry and installation state for importer, connector and pet
packages. The default policy is deliberately conservative: catalog packages are
**data/manifest packages**, not arbitrary executable code. Unknown manifests
that request `exec`, `shell`, `python_entry`, `node_entry` or `postinstall` are
rejected by the local installer.

A future signed marketplace can add audited executable adapters behind an
explicit permission/review model without changing the core Entry/Inbox contract.
