# Security policy

OpenPlait 1.0.0 is the current stable package line. The portable Query IR
remains `openplait.io/v1alpha1`.

Please report suspected vulnerabilities privately to the OpenLIT maintainers
through the security-reporting channel listed in the parent OpenLIT project. Do
not include credentials, production query results, or tenant data in a public
issue.

Query and adapter changes must preserve bound values, identifier allowlists,
tenant filters, result limits, time-range limits, read-only execution, timeout,
cancellation, and audit metadata. Semantic mode must never allow arbitrary
table or function access.
