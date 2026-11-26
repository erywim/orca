import type { GlobalSettings } from '../../../../../../shared/settings/global-settings-types'
import { SearchableSetting } from '../../section-layout/SearchableSetting'
import { SettingsSwitchRow } from '../../form-controls/SettingsFormControls'
import { getLinkRoutingTabPlacementSearchEntry } from './browser-link-routing-copy'
import { useTranslate } from '../../../../i18n/use-translate'

type BrowserLinkPlacementSettingProps = {
  settings: Pick<GlobalSettings, 'openLinksInTab'>
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

export function BrowserLinkPlacementSetting({
  settings,
  updateSettings
}: BrowserLinkPlacementSettingProps): React.JSX.Element {
  const t = useTranslate()
  const entry = getLinkRoutingTabPlacementSearchEntry(t)

  return (
    <SearchableSetting
      title={entry.title}
      description={entry.description}
      keywords={entry.keywords}
    >
      <div className="ml-4 border-l border-border pl-4">
        <SettingsSwitchRow
          label={entry.title}
          description={entry.description}
          checked={settings.openLinksInTab === true}
          onChange={() => updateSettings({ openLinksInTab: settings.openLinksInTab !== true })}
        />
      </div>
    </SearchableSetting>
  )
}
