import { defineFixture } from '../../../../component-fixtures/component-fixture'
import { getDefaultSettings } from '../../../../../../shared/orca-profiles/constants'
import { SettingsGroup } from '../../section-layout/SettingsGroup'
import { BrowserLinkPlacementSetting } from './BrowserLinkPlacementSetting'

const store = { settings: { ...getDefaultSettings('/tmp'), uiLanguage: 'en' as const } }

function Placement({ openLinksInTab }: { openLinksInTab: boolean }): React.JSX.Element {
  return (
    <div className="p-4">
      <SettingsGroup>
        <BrowserLinkPlacementSetting settings={{ openLinksInTab }} updateSettings={() => {}} />
      </SettingsGroup>
    </div>
  )
}

export const off = defineFixture({
  store,
  width: 720,
  render: () => <Placement openLinksInTab={false} />
})

export const on = defineFixture({
  store,
  width: 720,
  render: () => <Placement openLinksInTab />
})
