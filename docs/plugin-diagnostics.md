# Local diagnostics retirement

Local diagnostics, its collection service, settings controls, Remote methods and
offline analyzer have been removed. The plugin no longer collects account,
compaction, Auto, physical request, credential-change or native logical
observations through that feature, even if an old switch remains enabled.

Existing diagnostic data and the four hidden legacy settings remain untouched.
They are not migrated or cleared. If an older plugin version is loaded again,
its saved settings may enable collection again. Removal from this release does
not change a plugin already loaded in Desktop; installing or restarting is a
separate action.

Native DSH Usage, the plugin's context incident notices, and immediate request
error guidance remain independent of the retired feature.
