import { PendingApprovalsHomePageCard } from '@backstage-community/plugin-scaffolder-approvals';
import { Content, Header, Page } from '@backstage/core-components';
import { HomePageStarredEntities, WelcomeTitle } from '@backstage/plugin-home';
import { Grid } from '@material-ui/core';

export const HomePage = () => (
  <Page themeId="home">
    <Header title={<WelcomeTitle />} pageTitleOverride="Home" />
    <Content>
      <Grid container spacing={3}>
        <Grid item xs={12} md={6}>
          {/* How many approval requests are waiting on you. Nothing reminds an
              approver a second time, so this is where they notice. */}
          <PendingApprovalsHomePageCard />
        </Grid>
        <Grid item xs={12} md={6}>
          <HomePageStarredEntities />
        </Grid>
      </Grid>
    </Content>
  </Page>
);
