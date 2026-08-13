# make-protocol-schemas-authoritative

Make declarative `src/protocol` schemas the sole definition and validation authority at peer receive, outbound send, and local persistence load; remove `SessionEndMessage` and complete-object guards; retain editor-session `blob:<id>` locators outside protocol data; and classify remote leave from Artico `PeerLeave` after a five-second online grace in isolated v6 rooms.
