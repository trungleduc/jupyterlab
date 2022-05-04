import { ISettingRegistry } from '@jupyterlab/settingregistry';
import type { FieldProps } from '@rjsf/core';
import React, { useState } from 'react';
import { ITranslator, TranslationBundle } from '@jupyterlab/translation';
import { UUID } from '@lumino/coreutils';
import { closeIcon } from '@jupyterlab/ui-components';
type TDict = { [key: string]: any };
interface IState {
  title?: string;
  desc?: string;
  items: TDict;
}
interface IProps extends FieldProps {
  translator: ITranslator;
}

interface ISettingPropertyMap {
  [key: string]: ISettingProperty;
}
interface ISettingProperty {
  property: string;
  type: 'boolean' | 'string' | 'number';
  value: any;
}
const SETTING_NAME = 'language_servers';
const SERVER_SETTINGS = 'serverSettings';
function debounce<Params extends any[]>(
  func: (...args: Params) => any,
  timeout: number = 500
): (...args: Params) => void {
  let timer: NodeJS.Timeout;
  return (...args: Params) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      func(...args);
    }, timeout);
  };
}

function BuildSettingForm(props: {
  trans: TranslationBundle;
  removeSetting: (key: string) => void;
  updateSetting: (hash: string, newSetting: TDict) => void;
  serverHash: string;
  settings: TDict;
  schema: TDict;
}): JSX.Element {
  const {
    [SERVER_SETTINGS]: serverSettingsSchema,
    ...otherSettingsSchema
  } = props.schema;
  const {
    [SERVER_SETTINGS]: serverSettings,
    serverName,
    ...otherSettings
  } = props.settings;

  const [currentServerName, setCurrentServerName] = useState<string>(
    serverName
  );
  const onServerNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    props.updateSetting(props.serverHash, { serverName: e.target.value });
    setCurrentServerName(e.target.value);
  };

  const serverSettingWithType: ISettingPropertyMap = {};
  Object.entries(serverSettings).forEach(([key, value]) => {
    const newProps: ISettingProperty = {
      property: key,
      type: typeof value as 'string' | 'number' | 'boolean',
      value
    };
    serverSettingWithType[UUID.uuid4()] = newProps;
  });
  const [propertyMap, setPropertyMap] = useState<ISettingPropertyMap>(
    serverSettingWithType
  );
  const defaultOtherSettings: TDict = {};

  Object.entries(otherSettingsSchema).forEach(([key, value]) => {
    if (key in otherSettings) {
      defaultOtherSettings[key] = otherSettings[key];
    } else {
      defaultOtherSettings[key] = value['default'];
    }
  });
  const [otherSettingsComposite, setOtherSettingsComposite] = useState<TDict>(
    defaultOtherSettings
  );
  const onOtherSettingsChange = (
    property: string,
    value: any,
    type: string
  ) => {
    let settingValue = value;
    if (type === 'number') {
      settingValue = parseFloat(value);
    }
    const newProps = {
      ...otherSettingsComposite,
      [property]: settingValue
    };
    props.updateSetting(props.serverHash, newProps);
    setOtherSettingsComposite(newProps);
  };

  const addProperty = () => {
    const hash = UUID.uuid4();
    const newMap: ISettingPropertyMap = {
      ...propertyMap,
      [hash]: { property: '', type: 'string', value: '' }
    };
    const payload: TDict = {};
    Object.values(newMap).forEach(value => {
      payload[value.property] = value.value;
    });
    props.updateSetting(props.serverHash, { [SERVER_SETTINGS]: payload });
    setPropertyMap(newMap);
  };
  const removeProperty = (entryHash: string) => {
    const newMap: ISettingPropertyMap = {};
    Object.entries(propertyMap).forEach(([hash, value]) => {
      if (hash !== entryHash) {
        newMap[hash] = value;
      }
      const payload: TDict = {};
      Object.values(newMap).forEach(value => {
        payload[value.property] = value.value;
      });
      props.updateSetting(props.serverHash, { [SERVER_SETTINGS]: payload });
      setPropertyMap(newMap);
    });
  };
  const setProperty = (hash: string, property: ISettingProperty): void => {
    if (hash in propertyMap) {
      const newMap: ISettingPropertyMap = { ...propertyMap, [hash]: property };
      const payload: TDict = {};
      Object.values(newMap).forEach(value => {
        payload[value.property] = value.value;
      });
      setPropertyMap(newMap);
      props.updateSetting(props.serverHash, { [SERVER_SETTINGS]: payload });
    }
  };
  return (
    <div className="array-item">
      <div className="form-group ">
        <div className="jp-FormGroup-content">
          <div className="jp-objectFieldWrapper">
            <fieldset>
              <div className="form-group small-field">
                <div className="jp-modifiedIndicator jp-errorIndicator"></div>
                <div className="jp-FormGroup-content">
                  <h3 className="jp-FormGroup-fieldLabel jp-FormGroup-contentItem">
                    Server name:
                  </h3>
                  <div className="jp-inputFieldWrapper jp-FormGroup-contentItem">
                    <input
                      className="form-control"
                      type="text"
                      required={true}
                      value={currentServerName}
                      onChange={e => {
                        onServerNameChange(e);
                      }}
                    />
                  </div>
                  <div className="validationErrors">
                    <div>
                      <ul className="error-detail bs-callout bs-callout-info">
                        <li className="text-danger">is a required property</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
              {Object.entries(otherSettingsSchema).map(
                ([property, value], idx) => {
                  return (
                    <div
                      key={`${idx}-${property}`}
                      className="form-group small-field"
                    >
                      <div className="jp-FormGroup-content">
                        <h3 className="jp-FormGroup-fieldLabel jp-FormGroup-contentItem">
                          {value.title}
                        </h3>
                        <div className="jp-inputFieldWrapper jp-FormGroup-contentItem">
                          <input
                            className="form-control"
                            placeholder=""
                            type={value.type}
                            value={otherSettingsComposite[property]}
                            onChange={e =>
                              onOtherSettingsChange(
                                property,
                                e.target.value,
                                value.type
                              )
                            }
                          />
                        </div>
                        <div className="jp-FormGroup-description">
                          {value.description}
                        </div>
                        <div className="validationErrors"></div>
                      </div>
                    </div>
                  );
                }
              )}
              <fieldset>
                <legend>{serverSettingsSchema['title']}</legend>
                {Object.entries(propertyMap).map(([hash, property]) => {
                  return (
                    <PropertyFrom
                      key={hash}
                      hash={hash}
                      property={property}
                      removeProperty={removeProperty}
                      setProperty={debounce(setProperty)}
                    />
                  );
                })}
                <span>{serverSettingsSchema['description']}</span>
              </fieldset>
            </fieldset>
          </div>
        </div>
      </div>
      <div className="jp-ArrayOperations">
        <button className="jp-mod-styled jp-mod-reject" onClick={addProperty}>
          {props.trans.__('Add property')}
        </button>
        <button
          className="jp-mod-styled jp-mod-warn jp-FormGroup-removeButton"
          onClick={() => props.removeSetting(props.serverHash)}
        >
          {props.trans.__('Remove server')}
        </button>
      </div>
    </div>
  );
}

function PropertyFrom(props: {
  hash: string;
  property: ISettingProperty;
  removeProperty: (hash: string) => void;
  setProperty: (hash: string, property: ISettingProperty) => void;
}): JSX.Element {
  const [state, setState] = useState<{
    property: string;
    type: 'boolean' | 'string' | 'number';
    value: any;
  }>({ ...props.property });
  const TYPE_MAP = { string: 'text', number: 'number', boolean: 'checkbox' };
  const removeItem = () => {
    props.removeProperty(props.hash);
  };
  const changeName = (newName: string) => {
    const newState = { ...state, property: newName };
    props.setProperty(props.hash, newState);
    setState(newState);
  };
  const changeValue = (
    newValue: any,
    type: 'string' | 'boolean' | 'number'
  ) => {
    let value = newValue;
    if (type === 'number') {
      value = parseFloat(newValue);
    }
    const newState = { ...state, value };
    props.setProperty(props.hash, newState);
    setState(newState);
  };
  const changeType = (newType: 'boolean' | 'string' | 'number') => {
    let value: string | boolean | number;
    if (newType === 'boolean') {
      value = false;
    } else if (newType === 'number') {
      value = 0;
    } else {
      value = '';
    }
    const newState = { ...state, type: newType, value };
    setState(newState);
    props.setProperty(props.hash, newState);
  };
  return (
    <div key={props.hash} className="form-group small-field">
      <div className="jp-FormGroup-content">
        <input
          style={{ marginRight: '25px' }}
          className="form-control"
          type="text"
          required={true}
          placeholder={'Property name'}
          value={state.property}
          onChange={e => {
            changeName(e.target.value);
          }}
        />
        <select
          style={{ marginRight: '25px' }}
          className="form-control"
          value={state.type}
          onChange={e =>
            changeType(e.target.value as 'boolean' | 'string' | 'number')
          }
        >
          <option value="string">String</option>
          <option value="number">Number</option>
          <option value="boolean">Boolean</option>
        </select>
        <input
          style={{ marginRight: '25px' }}
          className="form-control"
          type={TYPE_MAP[state.type]}
          required={false}
          placeholder={'Property value'}
          value={state.type !== 'boolean' ? state.value : undefined}
          checked={state.type === 'boolean' ? state.value : undefined}
          onChange={
            state.type !== 'boolean'
              ? e => changeValue(e.target.value, state.type)
              : e => changeValue(e.target.checked, state.type)
          }
        />
        <button className="jp-mod-minimal jp-Button" onClick={removeItem}>
          <closeIcon.react />
        </button>
      </div>
    </div>
  );
}

class SettingRenderer extends React.Component<IProps, IState> {
  private _setting: ISettingRegistry.ISettings;
  private _trans: TranslationBundle;
  private _defaultSetting: TDict;
  private _schema: TDict;
  constructor(props: IProps) {
    super(props);
    this._setting = props.formContext.settings;
    this._trans = props.translator.load('jupyterlab');

    const schema = this._setting.schema['definitions'] as TDict;
    this._defaultSetting = schema['language-server']['default'];
    this._schema = schema['language-server']['properties'];
    const title = props.schema.title;
    const desc = props.schema.description;
    const settings: ISettingRegistry.ISettings = props.formContext.settings;
    const compositeData = settings.get(SETTING_NAME).composite as TDict;

    let items: TDict = {};
    if (compositeData) {
      Object.entries(compositeData).forEach(([key, value]) => {
        if (value) {
          const hash = UUID.uuid4();
          items[hash] = { serverName: key, ...value };
        }
      });
    }
    this.state = { title, desc, items };
  }

  removeSetting = (hash: string): void => {
    if (hash in this.state.items) {
      const items: TDict = {};
      for (const key in this.state.items) {
        if (key !== hash) {
          items[key] = this.state.items[key];
        }
      }
      this.setState(
        old => {
          return { ...old, items };
        },
        () => {
          this.saveServerSetting();
        }
      );
    }
  };

  updateSetting = (hash: string, newSetting: TDict): void => {
    if (hash in this.state.items) {
      const items: TDict = {};
      for (const key in this.state.items) {
        if (key === hash) {
          items[key] = { ...this.state.items[key], ...newSetting };
        } else {
          items[key] = this.state.items[key];
        }
      }
      this.setState(
        old => {
          return { ...old, items };
        },
        () => {
          this.saveServerSetting();
        }
      );
    }
  };

  addServerSetting = (): void => {
    let index = 0;
    let key = 'newKey';
    while (
      Object.values(this.state.items)
        .map(val => val.serverName)
        .includes(key)
    ) {
      index += 1;
      key = `newKey-${index}`;
    }
    this.setState(
      old => ({
        ...old,
        items: {
          ...old.items,
          [UUID.uuid4()]: { ...this._defaultSetting, serverName: key }
        }
      }),
      () => {
        this.saveServerSetting();
      }
    );
  };

  saveServerSetting = () => {
    const settings: TDict = {};
    Object.values(this.state.items).forEach(item => {
      const { serverName, ...setting } = item;
      settings[serverName] = setting;
    });
    this._setting.set(SETTING_NAME, settings).catch(console.error);
  };
  render(): JSX.Element {
    return (
      <div>
        <fieldset>
          <legend>{this.state.title}</legend>
          <p className="field-description">{this.state.desc}</p>
          <div className="field field-array field-array-of-object">
            {Object.entries(this.state.items).map(([hash, value], idx) => {
              return (
                <BuildSettingForm
                  key={`${idx}-${hash}`}
                  trans={this._trans}
                  removeSetting={this.removeSetting}
                  updateSetting={debounce(this.updateSetting)}
                  serverHash={hash}
                  settings={value}
                  schema={this._schema}
                />
              );
            })}
          </div>
          <div>
            <button
              style={{ margin: 2 }}
              className="jp-mod-styled jp-mod-reject"
              onClick={this.addServerSetting}
            >
              {this._trans.__('Add server')}
            </button>
          </div>
        </fieldset>
      </div>
    );
  }
}

/**
 * Custom setting renderer for language server.
 */
export function renderServerSetting(
  props: FieldProps,
  translator: ITranslator
): JSX.Element {
  return <SettingRenderer {...props} translator={translator} />;
}
