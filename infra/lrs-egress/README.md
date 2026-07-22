# Developer VPN access with Microsoft Entra ID

Use the Azure VPN Client to reach the Ministry of Education staging LRS through
the same Azure Firewall egress IP used by the Spark App Service.

## Network details

- VPN gateway: `vpng-yuvi-we`
- Resource group: `rg-yuvi-720`
- Authentication: Microsoft Entra ID
- VPN client pool: `172.20.20.0/24`
- LRS: `lrs-stg.education.gov.il` (`84.110.148.82/32`)
- Shared Azure Firewall egress IP: `104.41.217.81`

Only the LRS route is sent through the VPN. Normal internet traffic continues
to use the developer's regular connection.

## Prerequisites

1. Install the latest Microsoft Azure VPN Client:
   - macOS: <https://apps.apple.com/app/azure-vpn-client/id1553936137>
   - Windows: install **Azure VPN Client** from the Microsoft Store.
2. Sign in with an organizational account in the Microsoft Entra tenant used by
   the `cotrade-ai-prod-credits` Azure subscription.
3. Install Azure CLI and run `az login` only if you need to generate the profile
   yourself.

## Get the VPN profile

Generate a fresh profile whenever the gateway authentication or routing changes:

```bash
PROFILE_URL=$(az network vnet-gateway vpn-client generate \
  --resource-group rg-yuvi-720 \
  --name vpng-yuvi-we \
  --output tsv)

curl --fail --location "$PROFILE_URL" --output vpn-client.zip
unzip vpn-client.zip -d vpn-client
```

Do not commit the downloaded ZIP or extracted profile. The generated URL is
temporary and should not be shared.

The import file is under the extracted `AzureVPN` folder and is normally named
`azurevpnconfig.xml` or `azurevpnconfig_aad.xml`.

## Connect

1. Open **Azure VPN Client**.
2. Select **Import** and choose the XML file from the extracted `AzureVPN` folder.
3. Confirm that **Authentication Type** is **Microsoft Entra ID**.
4. Save the connection and select **Connect**.
5. Complete the organizational sign-in and MFA flow.

A successful connection receives an address in `172.20.20.0/24` and displays the
route `84.110.148.82/32`.

## Verify routing

On macOS:

```bash
route -n get 84.110.148.82
```

On Windows:

```powershell
route print 84.110.148.82
```

The LRS route must use the VPN interface. Do not use a public "what is my IP"
site to test this setup: only the LRS `/32` uses the VPN, so those sites show the
developer's normal public IP.

To verify end-to-end traffic, send an HTTPS request to the LRS and check Azure
Firewall logs for traffic from `172.20.20.0/24` to `84.110.148.82:443`. An allowed
entry confirms that Azure Firewall handles the request and SNATs it through
`104.41.217.81`, the same firewall public IP used by the App Service LRS route.

## Troubleshooting

- **The profile asks for a certificate:** Delete it and generate a fresh profile;
  the gateway now uses Microsoft Entra ID, not certificate authentication.
- **Connected but LRS times out:** Confirm the `/32` route is present and inspect
  Azure Firewall logs. If the firewall allows the request but the destination does
  not answer, confirm that `104.41.217.81` is allowlisted by the LRS team.
- **The LRS DNS address changed:** Update the Azure routes and firewall rules before
  distributing a new client profile.