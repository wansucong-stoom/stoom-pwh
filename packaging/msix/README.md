# MSIX packaging identity

`pwh-icon-256.png` is the approved STOOM product identity v1 Pwh icon, copied
without alteration. SHA-256:
`a1b8eea130ebe2f67e01b29cee9911ff1bfb6662851291111a786edc8a34e9cd`.
It retains the common product lettering, mark geometry, dark backing and compact
cyan glow. The Windows build scales it to 44, 50 and 150 pixels for package assets.
At small sizes product text legibility remains limited, as in the accepted kit.

Store identity is supplied as an external JSON file with `name`, `publisher` and
`publisherDisplayName`, copied exactly from Partner Center > Product identity.
Do not invent these identifiers or commit account-specific identity files.
The preview channel uses a separate unsigned testing namespace and display name.

See [MSIX build and verification](../../docs/MSIX.md).
