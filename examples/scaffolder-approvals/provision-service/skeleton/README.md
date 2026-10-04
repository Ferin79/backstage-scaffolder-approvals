# ${{ values.displayName }}

${{ values.description }}

| | |
| --- | --- |
| Owner | ${{ values.ownerTitle }} (`${{ values.owner }}`) |
{%- if values.system %}
| System | `${{ values.system }}` |
{%- endif %}
| Lifecycle | ${{ values.lifecycle }} |
| Tier | ${{ values.tier }} |
| Runtime | {% if values.language == 'typescript' %}Node.js ${{ values.nodeVersion }}{% elif values.language == 'go' %}Go ${{ values.goVersion }}{% elif values.language == 'java' %}Java ${{ values.javaVersion }}, built with ${{ values.buildTool }}{% else %}Python ${{ values.pythonVersion }}{% endif %} |
| Container | {% if values.containerised %}`${{ values.baseImage }}`{% else %}no{% endif %} |
| Size | ${{ values.replicas }} x ${{ values.cpu }} CPU, ${{ values.memoryMb }} MiB |
| Launch | ${{ values.launchDate }} |
| Data | ${{ values.dataClassification }}{% if values.securityReview %}, reviewed in ${{ values.securityReview }}, kept ${{ values.retentionDays }} days{% endif %} |

## Environments

| Environment | URL | Deploy on merge | Minimum replicas |
| --- | --- | --- | --- |
{%- for env in values.environments %}
| ${{ env.name }} | ${{ env.url }} | {% if env.autoDeploy %}yes{% else %}no{% endif %} | ${{ env.minReplicas }} |
{%- endfor %}

Regions: {% for region in values.regions %}`${{ region }}`{% if not loop.last %}, {% endif %}{% endfor %}

## On-call

- Primary contact: ${{ values.oncall.primaryContact }}
- Escalates after ${{ values.oncall.escalationMinutes }} minutes
- Pages out of hours: {% if values.oncall.pagerEnabled %}yes{% else %}no{% endif %}
{%- if values.alertChannels | length %}
- Alerts go to: ${{ values.alertChannels | join(', ') }}
{%- endif %}

{%- if values.featureFlags | length %}

## Feature flags, in rollout order

{%- for flag in values.featureFlags %}
${{ loop.index }}. `${{ flag }}`
{%- endfor %}
{%- endif %}

{%- if values.dependsOn | length or values.providesApis | length %}

## Relations
{%- for ref in values.dependsOn %}
- Depends on `${{ ref }}`
{%- endfor %}
{%- for ref in values.providesApis %}
- Provides `${{ ref }}`
{%- endfor %}
{%- endif %}

{%- if values.tags | length %}

Tags: ${{ values.tags | join(', ') }}
{%- endif %}

## Provenance

Requested by `${{ values.requestedBy }}` and approved by `${{ values.approvedBy | join('`, `') }}` in approval request `${{ values.approvalRequest }}`.
