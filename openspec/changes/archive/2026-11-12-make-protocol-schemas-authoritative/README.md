# make-protocol-schemas-authoritative

Make declarative `src/protocol` schemas the sole definition and validation authority, remove `SessionEndMessage`, and classify remote leave from Artico `PeerLeave` after a five-second online grace in isolated v5 rooms.
